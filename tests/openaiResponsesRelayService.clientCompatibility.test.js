const { PassThrough } = require('stream')
const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn(),
  normalizeProviderEndpoint: jest.fn((providerEndpoint) => providerEndpoint || 'responses'),
  getMappedModel: jest.fn((modelMapping, requestedModel) => requestedModel)
}))
jest.mock('../src/services/apiKeyService', () => ({
  recordUsage: jest.fn()
}))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  markAccountRateLimited: jest.fn(),
  isAccountRateLimited: jest.fn().mockResolvedValue(false),
  removeAccountRateLimit: jest.fn(),
  markAccountUnauthorized: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn(),
  sanitizeErrorForClient: jest.fn((errorData) => errorData)
}))
jest.mock('../src/services/cache/gptcache/openaiCacheChainService', () => ({
  beginRequest: jest.fn(),
  prepareStreamWriteback: jest.fn(async (decision) => decision),
  storeUpstreamResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn(),
  recordCacheReplay: jest.fn()
}))

const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const apiKeyService = require('../src/services/apiKeyService')
const openaiCacheChainService = require('../src/services/cache/gptcache/openaiCacheChainService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

function createSseStream(events) {
  const stream = new PassThrough()
  process.nextTick(() => {
    events.forEach((event) => stream.write(event))
    stream.end()
  })
  return stream
}

describe('openaiResponsesRelayService standard responses client compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'bypass',
      source: 'upstream',
      l1Decision: {
        kind: 'bypass',
        reason: 'cache_disabled'
      },
      l2Decision: {
        kind: 'bypass',
        reason: 'cache_disabled'
      }
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('retries standard non-stream string input requests with upstream-compatible responses payload', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-compat-1',
      name: 'Compatibility Account',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses'
    })

    axios
      .mockResolvedValueOnce({
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        data: {
          detail: 'Stream must be set to true'
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: createSseStream([
          'data: {"type":"response.created","response":{"id":"resp_compat_1","object":"response","status":"in_progress","model":"gpt-5.4","output":[]}}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_compat_1","object":"response","status":"completed","model":"gpt-5.4","output":[{"type":"message","id":"msg_compat_1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"standard compatibility ok"}]}],"usage":{"input_tokens":9,"output_tokens":4,"total_tokens":13}}}\n\n'
        ])
      })

    jest.spyOn(openaiResponsesRelayService, '_throttledUpdateLastUsedAt').mockResolvedValue()

    const req = {
      method: 'POST',
      path: '/openai/responses'.replace('/openai', ''),
      headers: {
        'user-agent': 'OpenAI/JS 4.0.0'
      },
      body: {
        model: 'gpt-5.4',
        input: 'Reply with exactly: standard compatibility ok',
        stream: false,
        max_output_tokens: 32
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn((payload) => payload)
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-compat-1', name: 'Compatibility Account', dailyQuota: '0' },
      { id: 'api-key-compat-1' }
    )

    expect(axios).toHaveBeenCalledTimes(2)
    expect(openaiResponsesAccountService.updateAccount).toHaveBeenCalledWith(
      'responses-compat-1',
      {
        supportsNonStreamingResponses: false
      }
    )
    expect(axios.mock.calls[1][0].data).toMatchObject({
      model: 'gpt-5.4',
      stream: true,
      input: [
        {
          role: 'user',
          content: 'Reply with exactly: standard compatibility ok'
        }
      ]
    })
    expect(openaiCacheChainService.storeUpstreamResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        statusCode: 200,
        body: expect.objectContaining({
          id: 'resp_compat_1',
          model: 'gpt-5.4'
        })
      })
    )
    expect(apiKeyService.recordUsage).toHaveBeenCalledWith(
      'api-key-compat-1',
      9,
      4,
      0,
      0,
      'gpt-5.4',
      'responses-compat-1',
      'openai-responses',
      null
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(result).toMatchObject({
      id: 'resp_compat_1',
      model: 'gpt-5.4',
      usage: {
        input_tokens: 9,
        output_tokens: 4,
        total_tokens: 13
      }
    })
  })

  it('retries standard stream requests when upstream requires input to be a list', async () => {
    const retryAttempt = openaiResponsesRelayService._buildCompatibilityRetryAttempt(
      {
        path: '/responses',
        body: {
          model: 'gpt-5.4',
          input: 'hello',
          stream: true
        },
        transform: 'passthrough',
        clientStream: true,
        aggregateResponse: false
      },
      {
        status: 400,
        data: {
          detail: 'Input must be a list'
        }
      }
    )

    expect(retryAttempt).toMatchObject({
      path: '/responses',
      clientStream: true,
      aggregateResponse: false,
      body: {
        model: 'gpt-5.4',
        stream: true,
        input: [
          {
            role: 'user',
            content: 'hello'
          }
        ]
      }
    })
  })
})
