jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (_req, _res, next) => next()
}))

jest.mock('../src/routes/openaiClaudeRoutes', () => ({
  handleChatCompletion: jest.fn()
}))

jest.mock('../src/handlers/geminiHandlers', () => ({
  handleStandardGenerateContent: jest.fn(),
  handleStandardStreamGenerateContent: jest.fn()
}))

jest.mock('../src/routes/openaiRoutes', () => ({
  CODEX_CLI_INSTRUCTIONS: 'codex instructions',
  handleResponses: jest.fn(),
  resolveOpenAIRequestContext: jest.fn()
}))

jest.mock('../src/services/apiKeyService', () => ({
  hasPermission: jest.fn()
}))

jest.mock('../src/services/geminiToOpenAI', () =>
  jest.fn().mockImplementation(() => ({
    createStreamState: jest.fn(),
    convertStreamChunk: jest.fn(),
    convertResponse: jest.fn()
  }))
)

jest.mock('../src/services/openaiProtocol/bridgeService', () => ({
  handleChatClientRequest: jest.fn()
}))

const openaiRoutes = require('../src/routes/openaiRoutes')
const apiKeyService = require('../src/services/apiKeyService')
const openaiProtocolBridgeService = require('../src/services/openaiProtocol/bridgeService')
const { routeToBackend } = require('../src/routes/unified')

describe('unified routeToBackend', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiKeyService.hasPermission.mockReturnValue(true)
  })

  it('forces /openai chat requests onto the OpenAI backend for custom upstream model names', async () => {
    openaiRoutes.resolveOpenAIRequestContext.mockResolvedValue({
      accountType: 'openai-responses',
      providerEndpoint: 'completions',
      account: { id: 'responses-1', name: 'Mimo Chat' }
    })
    openaiProtocolBridgeService.handleChatClientRequest.mockResolvedValue('relay-result')

    const req = {
      baseUrl: '/openai',
      originalUrl: '/openai/v1/chat/completions',
      headers: {},
      body: {
        model: 'mimo-v2-pro',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false
      },
      apiKey: { permissions: ['openai'] }
    }
    const res = {
      json: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      statusCode: 200
    }

    const result = await routeToBackend(req, res, 'mimo-v2-pro')

    expect(result).toBe('relay-result')
    expect(openaiRoutes.resolveOpenAIRequestContext).toHaveBeenCalledWith(
      req.apiKey,
      null,
      'mimo-v2-pro',
      expect.objectContaining({
        clientProtocol: 'chat_completions',
        needsStreaming: false,
        needsTools: false
      })
    )
    expect(openaiProtocolBridgeService.handleChatClientRequest).toHaveBeenCalledWith(
      req,
      res,
      { id: 'responses-1', name: 'Mimo Chat' },
      req.apiKey,
      {
        requestedModel: 'mimo-v2-pro',
        providerEndpoint: 'completions',
        codexInstructions: 'codex instructions'
      }
    )
    expect(openaiRoutes.handleResponses).not.toHaveBeenCalled()
  })

  it('routes chat/completions requests for responses upstream accounts through the bridge', async () => {
    openaiRoutes.resolveOpenAIRequestContext.mockResolvedValue({
      accountType: 'openai-responses',
      providerEndpoint: 'responses',
      account: { id: 'responses-2', name: 'Responses Upstream' }
    })
    openaiProtocolBridgeService.handleChatClientRequest.mockResolvedValue('responses-result')

    const req = {
      baseUrl: '/openai',
      originalUrl: '/openai/v1/chat/completions',
      headers: {},
      body: {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false
      },
      apiKey: { permissions: ['openai'] },
      path: '/v1/chat/completions'
    }
    const res = {
      json: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      statusCode: 200
    }

    const result = await routeToBackend(req, res, 'gpt-5')

    expect(result).toBe('responses-result')
    expect(openaiRoutes.resolveOpenAIRequestContext).toHaveBeenCalledWith(
      req.apiKey,
      null,
      'gpt-5',
      expect.objectContaining({
        clientProtocol: 'chat_completions',
        needsStreaming: false,
        needsTools: false
      })
    )
    expect(openaiProtocolBridgeService.handleChatClientRequest).toHaveBeenCalledWith(
      req,
      res,
      { id: 'responses-2', name: 'Responses Upstream' },
      req.apiKey,
      {
        requestedModel: 'gpt-5',
        providerEndpoint: 'responses',
        codexInstructions: 'codex instructions'
      }
    )
    expect(openaiRoutes.handleResponses).not.toHaveBeenCalled()
  })
})
