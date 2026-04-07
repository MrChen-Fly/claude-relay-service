jest.mock('../src/models/redis', () => ({
  incrementTokenUsage: jest.fn(),
  incrementDailyCost: jest.fn(),
  getApiKey: jest.fn(),
  setApiKey: jest.fn(),
  addUsageRecord: jest.fn(),
  incrementAccountUsage: jest.fn(),
  backfillInferredCacheCreateTokens: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  database: jest.fn()
}))

jest.mock('../src/services/serviceRatesService', () => ({
  getService: jest.fn(() => 'openai-responses'),
  getServiceRate: jest.fn().mockResolvedValue(1)
}))

jest.mock('../src/utils/modelHelper', () => ({
  isClaudeFamilyModel: jest.fn(() => false)
}))

jest.mock('../src/utils/costCalculator', () => ({
  calculateCost: jest.fn(() => ({
    costs: {
      input: 1,
      output: 0.5,
      cacheWrite: 0,
      cacheRead: 0.25,
      total: 1.75
    }
  }))
}))

jest.mock('../src/services/apiKeyIndexService', () => ({
  updateLastUsedAt: jest.fn()
}))

const redis = require('../src/models/redis')
const apiKeyService = require('../src/services/apiKeyService')

describe('apiKeyService cache creation inference', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    redis.getApiKey.mockResolvedValue({
      id: 'key-1',
      serviceRates: '{}'
    })
    redis.incrementTokenUsage.mockResolvedValue()
    redis.incrementDailyCost.mockResolvedValue()
    redis.setApiKey.mockResolvedValue()
    redis.addUsageRecord.mockResolvedValue()
    redis.incrementAccountUsage.mockResolvedValue()
    redis.backfillInferredCacheCreateTokens.mockResolvedValue(null)
  })

  it('tries to backfill inferred cache creation tokens for openai-responses requests with prompt_cache_key hits', async () => {
    await apiKeyService.recordUsage(
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

    expect(redis.backfillInferredCacheCreateTokens).toHaveBeenCalledWith('key-1', {
      accountId: 'responses-1',
      cacheReadTokens: 121344,
      model: 'gpt-5.3-codex',
      promptCacheKey: 'relay-cache-key-1'
    })

    expect(redis.addUsageRecord).toHaveBeenCalledWith(
      'key-1',
      expect.objectContaining({
        promptCacheKey: 'relay-cache-key-1',
        reportedCacheCreateTokens: 0,
        inferredCacheCreateTokens: 0,
        cacheCreateTokens: 0,
        cacheReadTokens: 121344
      })
    )
  })

  it('skips cache creation inference when the request has no prompt_cache_key', async () => {
    await apiKeyService.recordUsage(
      'key-1',
      158,
      7,
      0,
      121344,
      'gpt-5.3-codex',
      'responses-1',
      'openai-responses'
    )

    expect(redis.backfillInferredCacheCreateTokens).not.toHaveBeenCalled()
  })

  it('skips cache creation inference when upstream already returned cache creation tokens', async () => {
    await apiKeyService.recordUsage(
      'key-1',
      158,
      7,
      120000,
      121344,
      'gpt-5.3-codex',
      'responses-1',
      'openai-responses',
      null,
      {
        promptCacheKey: 'relay-cache-key-1'
      }
    )

    expect(redis.backfillInferredCacheCreateTokens).not.toHaveBeenCalled()
  })
})
