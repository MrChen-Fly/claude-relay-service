const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn(),
  normalizeProviderEndpoint: jest.fn((providerEndpoint) => providerEndpoint || 'responses'),
  getMappedModel: jest.fn((modelMapping, requestedModel) => {
    if (!modelMapping || !requestedModel) {
      return requestedModel
    }

    return modelMapping[requestedModel] || requestedModel
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

describe('openaiResponsesRelayService account model mapping integration', () => {
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

  it('rewrites the upstream model before sending the OpenAI Responses request', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses One',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses',
      modelMapping: {
        'gpt-5.4': 'st/OpenAI/gpt-5.4-2026-03-05'
      }
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
    expect(openaiResponsesAccountService.getMappedModel).toHaveBeenCalledWith(
      {
        'gpt-5.4': 'st/OpenAI/gpt-5.4-2026-03-05'
      },
      'gpt-5.4'
    )
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].data.model).toBe('st/OpenAI/gpt-5.4-2026-03-05')
  })

  it('preserves chat/completions requests for completions upstream accounts', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-2',
      name: 'Completions One',
      baseApi: 'https://relay.example.com/v1',
      apiKey: 'secret-key',
      providerEndpoint: 'completions'
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
      path: '/v1/chat/completions',
      headers: {},
      body: {
        model: 'mimo-v2-pro',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn()
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-2', name: 'Completions One' },
      { id: 'api-key-2' }
    )

    expect(result).toBe('done')
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].url).toBe('https://relay.example.com/v1/chat/completions')
    expect(axios.mock.calls[0][0].data.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('normalizes implicit function tools before sending responses requests upstream', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-implicit-tools-1',
      name: 'Implicit Tools Account',
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
      path: '/v1/responses',
      headers: {},
      body: {
        model: 'gpt-5.4',
        input: [{ role: 'user', content: 'hello' }],
        stream: false
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn()
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-implicit-tools-1', name: 'Implicit Tools Account' },
      { id: 'api-key-implicit-tools-1' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: {
              model: 'gpt-5.4',
              input: [{ role: 'user', content: 'hello' }],
              stream: false,
              tools: [
                {
                  name: 'echo_note',
                  description: 'Echo a note string back to the caller when explicitly needed.',
                  parameters: {
                    type: 'object',
                    properties: {
                      note: { type: 'string' }
                    },
                    required: ['note']
                  },
                  strict: true
                }
              ],
              tool_choice: {
                name: 'echo_note'
              }
            },
            transform: 'passthrough',
            requestedModel: 'gpt-5.4'
          }
        ]
      }
    )

    expect(result).toBe('done')
    expect(openaiCacheChainService.beginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          model: 'gpt-5.4',
          input: [{ role: 'user', content: 'hello' }],
          stream: false,
          tools: [
            {
              type: 'function',
              name: 'echo_note',
              description: 'Echo a note string back to the caller when explicitly needed.',
              parameters: {
                type: 'object',
                properties: {
                  note: { type: 'string' }
                },
                required: ['note']
              },
              strict: true
            }
          ],
          tool_choice: {
            type: 'function',
            name: 'echo_note'
          }
        }
      })
    )
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].data.tools).toEqual([
      {
        type: 'function',
        name: 'echo_note',
        description: 'Echo a note string back to the caller when explicitly needed.',
        parameters: {
          type: 'object',
          properties: {
            note: { type: 'string' }
          },
          required: ['note']
        },
        strict: true
      }
    ])
    expect(axios.mock.calls[0][0].data.tool_choice).toEqual({
      type: 'function',
      name: 'echo_note'
    })
  })

  it('adds empty properties for responses function tools with bare object schemas', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-implicit-tools-2',
      name: 'Implicit Tools Empty Schema Account',
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
      path: '/v1/responses',
      headers: {},
      body: {
        model: 'gpt-5.4',
        input: [{ role: 'user', content: 'hello' }],
        stream: false
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn()
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-implicit-tools-2', name: 'Implicit Tools Empty Schema Account' },
      { id: 'api-key-implicit-tools-2' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: {
              model: 'gpt-5.4',
              input: [{ role: 'user', content: 'hello' }],
              stream: false,
              tools: [
                {
                  name: 'runtime_status',
                  description: 'Read runtime status from MCP.',
                  parameters: {
                    type: 'object'
                  }
                }
              ],
              tool_choice: {
                name: 'runtime_status'
              }
            },
            transform: 'passthrough',
            requestedModel: 'gpt-5.4'
          }
        ]
      }
    )

    expect(result).toBe('done')
    expect(axios).toHaveBeenCalledTimes(1)
    expect(axios.mock.calls[0][0].data.tools).toEqual([
      {
        type: 'function',
        name: 'runtime_status',
        description: 'Read runtime status from MCP.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    ])
    expect(axios.mock.calls[0][0].data.tool_choice).toEqual({
      type: 'function',
      name: 'runtime_status'
    })
  })

  it('retries the alternate protocol and converts the final response when the first endpoint is rejected', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-3',
      name: 'Fallback Account',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'auto'
    })
    axios
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: {
          error: {
            message: 'unknown endpoint /v1/responses',
            type: 'invalid_request_error'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          id: 'chatcmpl_1',
          created: 1710000000,
          model: 'mimo-v2-pro',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'OK'
              }
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14
          }
        }
      })

    jest.spyOn(openaiResponsesRelayService, '_throttledUpdateLastUsedAt').mockResolvedValue()

    const req = {
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: {
        model: 'mimo-v2-pro',
        input: [{ role: 'user', content: 'hello' }],
        stream: false
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
      { id: 'responses-3', name: 'Fallback Account', dailyQuota: '0' },
      { id: 'api-key-3' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: {
              model: 'mimo-v2-pro',
              input: [{ role: 'user', content: 'hello' }],
              stream: false
            },
            transform: 'passthrough',
            requestedModel: 'mimo-v2-pro'
          },
          {
            path: '/v1/chat/completions',
            body: {
              model: 'mimo-v2-pro',
              messages: [{ role: 'user', content: 'hello' }],
              stream: false
            },
            transform: 'chat_to_responses',
            requestedModel: 'mimo-v2-pro'
          }
        ]
      }
    )

    expect(axios).toHaveBeenCalledTimes(2)
    expect(axios.mock.calls[0][0].url).toBe('https://relay.example.com/v1/responses')
    expect(axios.mock.calls[1][0].url).toBe('https://relay.example.com/v1/chat/completions')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(result).toMatchObject({
      object: 'response',
      model: 'mimo-v2-pro',
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        total_tokens: 14
      }
    })
  })

  it('retries the alternate protocol when the first endpoint returns an empty success body', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-empty-1',
      name: 'Empty Success Account',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses'
    })
    axios
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json'
        },
        data: ''
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          id: 'chatcmpl_empty_fallback_1',
          created: 1710000001,
          model: 'mimo-v2-pro',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'Recovered via fallback'
              }
            }
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 5,
            total_tokens: 13
          }
        }
      })

    jest.spyOn(openaiResponsesRelayService, '_throttledUpdateLastUsedAt').mockResolvedValue()

    const req = {
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: {
        model: 'mimo-v2-pro',
        input: [{ role: 'user', content: 'hello' }],
        stream: false
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
      { id: 'responses-empty-1', name: 'Empty Success Account', dailyQuota: '0' },
      { id: 'api-key-empty-1' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: {
              model: 'mimo-v2-pro',
              input: [{ role: 'user', content: 'hello' }],
              stream: false
            },
            transform: 'passthrough',
            requestedModel: 'mimo-v2-pro'
          },
          {
            path: '/v1/chat/completions',
            body: {
              model: 'mimo-v2-pro',
              messages: [{ role: 'user', content: 'hello' }],
              stream: false
            },
            transform: 'chat_to_responses',
            requestedModel: 'mimo-v2-pro'
          }
        ]
      }
    )

    expect(axios).toHaveBeenCalledTimes(2)
    expect(axios.mock.calls[0][0].url).toBe('https://relay.example.com/v1/responses')
    expect(axios.mock.calls[1][0].url).toBe('https://relay.example.com/v1/chat/completions')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(result).toMatchObject({
      object: 'response',
      model: 'mimo-v2-pro',
      usage: {
        input_tokens: 8,
        output_tokens: 5,
        total_tokens: 13
      }
    })
  })

  it('records chat completions usage from non-stream responses', async () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }

    await openaiResponsesRelayService._handleNormalResponse(
      {
        status: 200,
        data: {
          model: 'mimo-v2-pro',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 6,
            total_tokens: 16
          },
          choices: [{ message: { role: 'assistant', content: 'OK' } }]
        }
      },
      res,
      { id: 'responses-4', dailyQuota: '0' },
      { id: 'api-key-4' },
      'mimo-v2-pro'
    )

    expect(apiKeyService.recordUsage).toHaveBeenCalledWith(
      'api-key-4',
      10,
      6,
      0,
      0,
      'mimo-v2-pro',
      'responses-4',
      'openai-responses',
      null
    )
    expect(openaiResponsesAccountService.updateAccountUsage).toHaveBeenCalledWith('responses-4', 16)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('retries the alternate protocol for stream responses when the responses endpoint is rejected', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-5',
      name: 'Stream Fallback Account',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses'
    })
    axios
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {
          pipe: jest.fn()
        }
      })

    jest.spyOn(openaiResponsesRelayService, '_throttledUpdateLastUsedAt').mockResolvedValue()
    jest.spyOn(openaiResponsesRelayService, '_handleStreamResponse').mockResolvedValue('stream-ok')

    const req = {
      method: 'POST',
      path: '/v1/responses',
      headers: {},
      body: {
        model: 'mimo-v2-pro',
        input: [{ role: 'user', content: 'hello' }],
        stream: true
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn()
    }

    const result = await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-5', name: 'Stream Fallback Account', dailyQuota: '0' },
      { id: 'api-key-5' },
      {
        attempts: [
          {
            path: '/v1/responses',
            body: {
              model: 'mimo-v2-pro',
              input: [{ role: 'user', content: 'hello' }],
              stream: true
            },
            transform: 'passthrough',
            requestedModel: 'mimo-v2-pro'
          },
          {
            path: '/v1/chat/completions',
            body: {
              model: 'mimo-v2-pro',
              messages: [{ role: 'user', content: 'hello' }],
              stream: true
            },
            transform: 'chat_to_responses',
            requestedModel: 'mimo-v2-pro'
          }
        ]
      }
    )

    expect(result).toBe('stream-ok')
    expect(axios).toHaveBeenCalledTimes(2)
    expect(axios.mock.calls[0][0].url).toBe('https://relay.example.com/v1/responses')
    expect(axios.mock.calls[1][0].url).toBe('https://relay.example.com/v1/chat/completions')
    expect(openaiResponsesRelayService._handleStreamResponse).toHaveBeenCalledWith(
      expect.any(Object),
      res,
      { id: 'responses-5', name: 'Stream Fallback Account', dailyQuota: '0' },
      { id: 'api-key-5' },
      'mimo-v2-pro',
      expect.any(Function),
      req,
      null,
      expect.objectContaining({
        convertJson: expect.any(Function)
      }),
      expect.any(Object),
      expect.any(Function)
    )
  })
})
