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

  it('falls back to responses when normalizeProviderEndpoint relies on service instance state', async () => {
    const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')

    openaiResponsesAccountService.normalizeProviderEndpoint.mockImplementation(
      function (providerEndpoint) {
        return this?.VALID_PROVIDER_ENDPOINTS?.includes(providerEndpoint)
          ? providerEndpoint
          : 'responses'
      }
    )

    const req = {
      apiKey: {
        id: 'api-key-5',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
        session_id: 'y'.repeat(32)
      },
      body: {
        model: 'mimo-v2-pro',
        stream: false,
        input: 'hello'
      },
      _openaiAuthContext: {
        accountType: 'openai-responses',
        account: {
          id: 'responses-2',
          name: 'Fallback Endpoint Account'
        }
      }
    }
    const res = {}

    const result = await handleResponses(req, res)

    expect(result).toBe('bridged')
    expect(bridgeService.handleResponsesClientRequest).toHaveBeenCalledWith(
      req,
      res,
      { id: 'responses-2', name: 'Fallback Endpoint Account' },
      req.apiKey,
      'mimo-v2-pro',
      { providerEndpoint: 'responses' }
    )
  })

  it('returns a sanitized account error when the linked OpenAI account is unavailable', async () => {
    const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
    const openaiAccountService = require('../src/services/account/openaiAccountService')

    scheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'openai-1',
      accountType: 'openai'
    })
    openaiAccountService.getAccount.mockResolvedValue(null)

    const req = {
      apiKey: {
        id: 'api-key-3',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0 (Windows 10.0.26100; x86_64) WindowsTerminal'
      },
      body: {
        model: 'gpt-5',
        input: 'hello'
      }
    }
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }

    await handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: 'Permission denied'
      }
    })
  })

  it('returns a sanitized auth error when OpenAI access token decryption fails', async () => {
    const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')
    const openaiAccountService = require('../src/services/account/openaiAccountService')

    scheduler.selectAccountForApiKey.mockResolvedValue({
      accountId: 'openai-2',
      accountType: 'openai'
    })
    openaiAccountService.getAccount.mockResolvedValue({
      id: 'openai-2',
      name: 'OpenAI Account',
      accessToken: 'encrypted-token'
    })
    openaiAccountService.decrypt.mockReturnValue('')

    const req = {
      apiKey: {
        id: 'api-key-4',
        permissions: ['openai']
      },
      path: '/v1/responses',
      url: '/v1/responses',
      originalUrl: '/openai/v1/responses',
      headers: {
        'user-agent': 'codex_cli_rs/0.81.0 (Windows 10.0.26100; x86_64) WindowsTerminal'
      },
      body: {
        model: 'gpt-5',
        input: 'hello'
      }
    }
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    }

    await handleResponses(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: 'Authentication failed'
      }
    })
  })
})
