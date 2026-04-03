const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn()
}))
jest.mock('../src/services/forwardingRuleService', () => ({
  rewriteRequestModel: jest.fn(async ({ requestBody }) => {
    requestBody.model = 'st/OpenAI/gpt-5.4-2026-03-05'
    return {
      matched: true,
      requestedModel: 'gpt-5.4',
      resolvedModel: 'st/OpenAI/gpt-5.4-2026-03-05',
      rule: { id: 'rule-1' }
    }
  })
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

const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const forwardingRuleService = require('../src/services/forwardingRuleService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

describe('openaiResponsesRelayService forwarding integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rewrites the upstream model before sending the OpenAI Responses request', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses One',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses'
    })
    axios.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { ok: true }
    })

    jest.spyOn(openaiResponsesRelayService, '_throttledUpdateLastUsedAt').mockResolvedValue()
    jest.spyOn(openaiResponsesRelayService, '_handleNormalResponse').mockResolvedValue('done')

    const req = {
      method: 'POST',
      path: '/responses',
      headers: {},
      body: {
        model: 'gpt-5.4',
        stream: false
      },
      once: jest.fn()
    }
    const res = {
      once: jest.fn()
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One' },
      { id: 'api-key-1' }
    )

    expect(result).toBe('done')
    expect(forwardingRuleService.rewriteRequestModel).toHaveBeenCalledWith({
      requestBody: req.body,
      platform: 'openai-responses',
      accountId: 'responses-1'
    })
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].data.model).toBe('st/OpenAI/gpt-5.4-2026-03-05')
  })
})
