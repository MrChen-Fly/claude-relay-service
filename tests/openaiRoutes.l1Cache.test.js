jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  security: jest.fn(),
  api: jest.fn()
}))
jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (_req, _res, next) => next()
}))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  selectAccountForApiKey: jest.fn()
}))
jest.mock('../src/services/account/openaiAccountService', () => ({
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  decrypt: jest.fn(),
  updateCodexUsageSnapshot: jest.fn()
}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  normalizeProviderEndpoint: jest.fn((value) => value || 'responses')
}))
jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({
  handleRequest: jest.fn()
}))
jest.mock('../src/services/openaiProtocol/bridgeService', () => ({
  handleResponsesClientRequest: jest.fn()
}))
jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn(() => true),
  recordUsage: jest.fn()
}))
jest.mock('../src/models/redis', () => ({}))
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn()
}))
jest.mock('../src/utils/rateLimitHelper', () => ({
  updateRateLimitCounters: jest.fn()
}))
jest.mock('../src/utils/errorSanitizer', () => ({
  getSafeMessage: jest.fn((value) => String(value?.message || value || 'error'))
}))
jest.mock('../src/services/cache/openaiL1CacheService', () => ({
  beginRequest: jest.fn(),
  storeResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn()
}))

const axios = require('axios')
const bridgeService = require('../src/services/openaiProtocol/bridgeService')
const apiKeyService = require('../src/services/apiKeyService')
const openaiL1CacheService = require('../src/services/cache/openaiL1CacheService')
const { handleResponses } = require('../src/routes/openaiRoutes')

describe('openaiRoutes L1 cache integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function createRes() {
    return {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }
  }

  it('short-circuits direct OpenAI non-stream requests on cache hit', async () => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'hit',
      entry: {
        statusCode: 200,
        body: { id: 'cached-response' },
        headers: {
          'x-request-id': 'cached-1'
        }
      }
    })
    openaiL1CacheService.replayCachedResponse.mockImplementation((res, entry) =>
      res.status(entry.statusCode).json(entry.body)
    )

    const req = {
      apiKey: {
        id: 'api-key-1',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0'
      },
      body: {
        model: 'gpt-5',
        input: 'hello',
        stream: false
      },
      _openaiAuthContext: {
        accessToken: 'token-1',
        accountId: 'openai-1',
        accountType: 'openai',
        proxy: null,
        account: {
          id: 'openai-1',
          name: 'OpenAI One',
          accountId: 'chatgpt-account-1'
        }
      }
    }
    const res = createRes()

    await handleResponses(req, res)

    expect(axios.post).not.toHaveBeenCalled()
    expect(apiKeyService.recordUsage).not.toHaveBeenCalled()
    expect(openaiL1CacheService.replayCachedResponse).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        statusCode: 200,
        body: { id: 'cached-response' }
      })
    )
  })

  it('skips direct-route caching when the request is routed through the protocol bridge', async () => {
    bridgeService.handleResponsesClientRequest.mockResolvedValue('bridged')

    const req = {
      apiKey: {
        id: 'api-key-2',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0'
      },
      body: {
        model: 'mimo-v2-pro',
        input: 'hello',
        stream: false
      },
      _openaiAuthContext: {
        accountType: 'openai-responses',
        providerEndpoint: 'completions',
        account: {
          id: 'responses-1',
          name: 'Responses One'
        }
      }
    }
    const res = createRes()

    const result = await handleResponses(req, res)

    expect(result).toBe('bridged')
    expect(openaiL1CacheService.beginRequest).not.toHaveBeenCalled()
  })
})
