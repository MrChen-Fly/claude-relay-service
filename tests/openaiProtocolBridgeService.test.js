jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({
  handleRequest: jest.fn()
}))

const bridgeService = require('../src/services/openaiProtocol/bridgeService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

describe('openaiProtocol bridge service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefers chat/completions for responses clients when the account hint is completions', async () => {
    openaiResponsesRelayService.handleRequest.mockResolvedValue('bridged')

    const req = {
      path: '/v1/responses',
      body: {
        model: 'mimo-v2-pro',
        instructions: 'Follow repository rules.',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Say OK.' }]
          }
        ],
        stream: false,
        prompt_cache_retention: { type: 'ephemeral', ttl_seconds: 86400 },
        reasoning: {
          effort: 'medium'
        }
      }
    }

    const result = await bridgeService.handleResponsesClientRequest(
      req,
      {},
      { id: 'responses-1', name: 'Mimo Chat' },
      { id: 'api-key-1' },
      'mimo-v2-pro',
      { providerEndpoint: 'completions' }
    )

    expect(result).toBe('bridged')
    expect(openaiResponsesRelayService.handleRequest).toHaveBeenCalledWith(
      req,
      {},
      { id: 'responses-1', name: 'Mimo Chat' },
      { id: 'api-key-1' },
      {
        attempts: [
          {
            path: '/v1/chat/completions',
            body: expect.objectContaining({
              model: 'mimo-v2-pro',
              stream: false,
              reasoning_effort: 'medium',
              prompt_cache_retention: { type: 'ephemeral', ttl_seconds: 86400 }
            }),
            transform: 'chat_to_responses',
            requestedModel: 'mimo-v2-pro'
          },
          {
            path: '/v1/responses',
            body: req.body,
            transform: 'passthrough',
            requestedModel: 'mimo-v2-pro'
          }
        ]
      }
    )

    const chatBody = openaiResponsesRelayService.handleRequest.mock.calls[0][4].attempts[0].body
    expect(chatBody.messages).toEqual([
      { role: 'system', content: 'Follow repository rules.' },
      { role: 'user', content: 'Say OK.' }
    ])
  })

  it('prefers responses upstream for chat clients when the account hint is responses', async () => {
    openaiResponsesRelayService.handleRequest.mockResolvedValue('responses-bridge')

    const req = {
      path: '/v1/chat/completions',
      body: {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
        prompt_cache_key: 'session-cache-key',
        prompt_cache_retention: { type: 'ephemeral', ttl_seconds: 86400 }
      }
    }

    const result = await bridgeService.handleChatClientRequest(
      req,
      {},
      { id: 'responses-2', name: 'Responses Upstream' },
      { id: 'api-key-2' },
      {
        requestedModel: 'gpt-5',
        providerEndpoint: 'responses',
        codexInstructions: 'codex instructions'
      }
    )

    expect(result).toBe('responses-bridge')
    expect(openaiResponsesRelayService.handleRequest).toHaveBeenCalledWith(
      req,
      {},
      { id: 'responses-2', name: 'Responses Upstream' },
      { id: 'api-key-2' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: expect.objectContaining({
              model: 'gpt-5',
              stream: true,
              instructions: 'codex instructions',
              prompt_cache_key: 'session-cache-key',
              prompt_cache_retention: { type: 'ephemeral', ttl_seconds: 86400 }
            }),
            transform: 'responses_to_chat',
            requestedModel: 'gpt-5'
          },
          {
            path: '/v1/chat/completions',
            body: req.body,
            transform: 'passthrough',
            requestedModel: 'gpt-5'
          }
        ]
      }
    )

    const responsesBody =
      openaiResponsesRelayService.handleRequest.mock.calls[0][4].attempts[0].body
    expect(responsesBody.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }]
      }
    ])
  })

  it('defaults to the client protocol first when the account hint is auto', async () => {
    openaiResponsesRelayService.handleRequest.mockResolvedValue('auto-bridge')

    const req = {
      path: '/v1/chat/completions',
      body: {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false
      }
    }

    await bridgeService.handleChatClientRequest(
      req,
      {},
      { id: 'responses-3', name: 'Auto Upstream' },
      { id: 'api-key-3' },
      {
        requestedModel: 'gpt-5',
        providerEndpoint: 'auto'
      }
    )

    expect(
      openaiResponsesRelayService.handleRequest.mock.calls[0][4].attempts.map(
        (attempt) => attempt.path
      )
    ).toEqual(['/v1/chat/completions', '/v1/responses'])
  })
})
