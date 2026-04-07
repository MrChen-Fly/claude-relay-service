jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  updateAccountUsage: jest.fn()
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
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn(),
  sanitizeErrorForClient: jest.fn((errorData) => errorData)
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const apiKeyService = require('../src/services/apiKeyService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

describe('openaiResponsesRelayService cache inference metadata forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('forwards prompt_cache_key metadata when recording normal response usage', async () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }

    await openaiResponsesRelayService._handleNormalResponse(
      {
        status: 200,
        data: {
          model: 'gpt-5.3-codex',
          usage: {
            input_tokens: 121502,
            input_tokens_details: {
              cached_tokens: 121344
            },
            output_tokens: 7,
            total_tokens: 121509
          }
        }
      },
      res,
      { id: 'responses-1', dailyQuota: '0' },
      { id: 'key-1' },
      'gpt-5.3-codex',
      null,
      null,
      {
        promptCacheKey: 'relay-cache-key-1'
      }
    )

    expect(apiKeyService.recordUsage).toHaveBeenCalledWith(
      'key-1',
      158,
      7,
      0,
      121344,
      'gpt-5.3-codex',
      'responses-1',
      'openai-responses',
      null,
      {
        promptCacheKey: 'relay-cache-key-1'
      }
    )
  })
})
