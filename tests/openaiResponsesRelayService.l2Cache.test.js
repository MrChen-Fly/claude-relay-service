const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn(),
  normalizeProviderEndpoint: jest.fn((providerEndpoint) => providerEndpoint || 'responses'),
  getMappedModel: jest.fn((_mapping, requestedModel) => requestedModel)
}))
jest.mock('../src/services/apiKeyService', () => ({
  recordUsage: jest.fn()
}))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  markAccountRateLimited: jest.fn(),
  isAccountRateLimited: jest.fn().mockResolvedValue(false),
  removeAccountRateLimit: jest.fn(),
  markAccountUnauthorized: jest.fn(),
  _deleteSessionMapping: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn(),
  sanitizeErrorForClient: jest.fn((errorData) => errorData)
}))
jest.mock('../src/models/redis', () => ({
  incrOpenAIResponsesAccountConcurrency: jest.fn().mockResolvedValue(1),
  decrOpenAIResponsesAccountConcurrency: jest.fn().mockResolvedValue(0),
  refreshOpenAIResponsesAccountConcurrencyLease: jest.fn()
}))
jest.mock('../src/services/cache/gptcache/openaiCacheChainService', () => ({
  beginRequest: jest.fn(),
  storeUpstreamResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn()
}))

const apiKeyService = require('../src/services/apiKeyService')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiCacheChainService = require('../src/services/cache/gptcache/openaiCacheChainService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

describe('openaiResponsesRelayService L2 cache integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses One',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses',
      dailyQuota: '0'
    })
  })

  function createReq(body = {}) {
    return {
      method: 'POST',
      path: '/responses',
      headers: {},
      body: {
        model: 'gpt-5',
        stream: false,
        input: 'hello',
        ...body
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
  }

  function createRes() {
    return {
      once: jest.fn(),
      removeListener: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }
  }

  it('short-circuits cache hits before calling upstream', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'hit',
      source: 'l2',
      entry: {
        statusCode: 200,
        body: { id: 'semantic-hit' },
        headers: { 'x-request-id': 'semantic-1' }
      }
    })
    openaiCacheChainService.replayCachedResponse.mockImplementation((res, decision) =>
      res.status(decision.entry.statusCode).json(decision.entry.body)
    )

    const req = createReq()
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One' },
      { id: 'api-key-1' }
    )

    expect(axios).not.toHaveBeenCalled()
    expect(apiKeyService.recordUsage).not.toHaveBeenCalled()
    expect(openaiCacheChainService.storeUpstreamResponse).not.toHaveBeenCalled()
    expect(openaiCacheChainService.replayCachedResponse).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        kind: 'hit',
        entry: expect.objectContaining({
          statusCode: 200,
          body: { id: 'semantic-hit' }
        })
      })
    )
  })

  it('stores cacheable upstream responses through the unified chain service', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'shadow_hit',
      source: 'upstream',
      l1Decision: {
        kind: 'bypass',
        reason: 'cache_disabled'
      },
      l2Decision: {
        kind: 'shadow_hit',
        tenantId: 'api-key-1'
      }
    })
    axios.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'upstream-1'
      },
      data: {
        id: 'resp_1',
        model: 'gpt-5',
        output: [{ type: 'output_text', text: 'hello' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        }
      }
    })

    const req = createReq()
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One', dailyQuota: '0' },
      { id: 'api-key-1' }
    )

    expect(openaiCacheChainService.storeUpstreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'shadow_hit',
        l2Decision: expect.objectContaining({
          tenantId: 'api-key-1'
        })
      }),
      expect.objectContaining({
        statusCode: 200,
        body: expect.objectContaining({
          id: 'resp_1'
        }),
        headers: expect.objectContaining({
          'x-request-id': 'upstream-1'
        }),
        actualModel: 'gpt-5'
      })
    )
  })
})
