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
  decrypt: jest.fn()
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
  hasPermission: jest.fn(() => true)
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

const bridgeService = require('../src/services/openaiProtocol/bridgeService')
const { handleResponses } = require('../src/routes/openaiRoutes')

describe('openaiRoutes protocol bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('routes responses clients through the protocol bridge with the upstream hint', async () => {
    bridgeService.handleResponsesClientRequest.mockResolvedValue('bridged')

    const req = {
      apiKey: {
        id: 'api-key-1',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
        session_id: 'x'.repeat(32)
      },
      body: {
        model: 'mimo-v2-pro',
        instructions:
          "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.",
        stream: false,
        prompt_cache_retention: { type: 'ephemeral', ttl_seconds: 86400 }
      },
      _openaiAuthContext: {
        accountType: 'openai-responses',
        providerEndpoint: 'completions',
        account: {
          id: 'responses-1',
          name: 'Mimo Chat'
        }
      }
    }
    const res = {}

    const result = await handleResponses(req, res)

    expect(result).toBe('bridged')
    expect(bridgeService.handleResponsesClientRequest).toHaveBeenCalledWith(
      req,
      res,
      { id: 'responses-1', name: 'Mimo Chat' },
      req.apiKey,
      'mimo-v2-pro',
      { providerEndpoint: 'completions' }
    )
    expect(req.body.prompt_cache_retention).toEqual({ type: 'ephemeral', ttl_seconds: 86400 })
  })

  it('returns the scheduler public message when no compatible account is available', async () => {
    const error = new Error('scheduler failure')
    error.statusCode = 400
    error.publicMessage = 'No available OpenAI accounts support the requested features'
    const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
    scheduler.selectAccountForApiKey.mockRejectedValue(error)

    const req = {
      apiKey: {
        id: 'api-key-2',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0 (Windows 10.0.26100; x86_64) WindowsTerminal'
      },
      body: {
        model: 'mimo-v2-pro',
        input: 'hello',
        reasoning: { effort: 'medium' }
      }
    }
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }

    await handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: 'No available OpenAI accounts support the requested features'
      }
    })
  })
})
