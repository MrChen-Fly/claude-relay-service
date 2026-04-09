const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn(),
  normalizeProviderEndpoint: jest.fn((providerEndpoint) => providerEndpoint || 'responses'),
  getMappedModel: jest.fn((_mapping, requestedModel) => requestedModel)
}))
jest.mock('../src/services/apiKeyService', () => ({
  recordUsage: jest.fn()
}))
jest.mock('../src/services/scheduler/unifiedOpenAIScheduler', () => ({
  markAccountRateLimited: jest.fn(),
  isAccountRateLimited: jest.fn().mockResolvedValue(false),
  removeAccountRateLimit: jest.fn(),
  markAccountUnauthorized: jest.fn(),
  _deleteSessionMapping: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn(),
  sanitizeErrorForClient: jest.fn((errorData) => errorData)
}))
jest.mock('../src/models/redis', () => ({
  incrOpenAIResponsesAccountConcurrency: jest.fn().mockResolvedValue(1),
  decrOpenAIResponsesAccountConcurrency: jest.fn().mockResolvedValue(0),
  refreshOpenAIResponsesAccountConcurrencyLease: jest.fn()
}))
jest.mock('../src/services/cache/gptcache/openaiCacheChainService', () => ({
  beginRequest: jest.fn(),
  prepareStreamWriteback: jest.fn(async (decision) => decision),
  storeUpstreamResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn(),
  recordCacheReplay: jest.fn()
}))

const apiKeyService = require('../src/services/apiKeyService')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiCacheChainService = require('../src/services/cache/gptcache/openaiCacheChainService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')

describe('openaiResponsesRelayService L2 cache integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses One',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses',
      dailyQuota: '0'
    })
  })

  function createReq(body = {}) {
    return {
      method: 'POST',
      path: '/responses',
      headers: {},
      body: {
        model: 'gpt-5',
        stream: false,
        input: 'hello',
        ...body
      },
      once: jest.fn(),
      removeListener: jest.fn()
    }
  }

  function createRes() {
    return {
      once: jest.fn(),
      removeListener: jest.fn(),
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      destroyed: false,
      headersSent: false
    }
  }

  it('short-circuits cache hits before calling upstream', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'hit',
      source: 'l2',
      entry: {
        statusCode: 200,
        body: { id: 'semantic-hit' },
        headers: { 'x-request-id': 'semantic-1' }
      }
    })
    openaiCacheChainService.replayCachedResponse.mockImplementation((res, decision) =>
      res.status(decision.entry.statusCode).json(decision.entry.body)
    )

    const req = createReq()
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One' },
      { id: 'api-key-1' }
    )

    expect(axios).not.toHaveBeenCalled()
    expect(apiKeyService.recordUsage).not.toHaveBeenCalled()
    expect(openaiCacheChainService.storeUpstreamResponse).not.toHaveBeenCalled()
    expect(openaiCacheChainService.replayCachedResponse).toHaveBeenCalledWith(
      res,
      expect.objectContaining({
        kind: 'hit',
        entry: expect.objectContaining({
          statusCode: 200,
          body: { id: 'semantic-hit' }
        })
      })
    )
  })

  it('replays cached responses stream hits as SSE without calling upstream', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'hit',
      source: 'l2',
      semanticRequestText: 'hello',
      entry: {
        statusCode: 200,
        body: {
          id: 'resp_stream_hit_1',
          object: 'response',
          created_at: '2026-04-08T12:00:00.000Z',
          status: 'completed',
          model: 'gpt-5',
          output: [
            {
              type: 'message',
              id: 'msg_1',
              status: 'completed',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'hello from cache'
                }
              ]
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15
          }
        },
        headers: {
          'x-request-id': 'cached-stream-1'
        }
      }
    })

    const req = createReq({
      stream: true
    })
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One' },
      { id: 'api-key-1' }
    )

    expect(axios).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.write).toHaveBeenCalled()
    const streamOutput = res.write.mock.calls.map(([chunk]) => chunk).join('')
    expect(streamOutput).toContain('"type":"response.output_text.delta"')
    expect(streamOutput).toContain('"type":"response.completed"')
    expect(res.end).toHaveBeenCalled()
    expect(openaiCacheChainService.recordCacheReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hit',
        source: 'l2'
      })
    )
  })

  it('replays cached chat completions stream hits as chunked SSE with done marker', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'hit',
      source: 'l1',
      entry: {
        statusCode: 200,
        body: {
          id: 'chatcmpl_cached_1',
          object: 'chat.completion',
          created: 1710000000,
          model: 'mimo-v2-pro',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'cached completion'
              }
            }
          ],
          usage: {
            prompt_tokens: 8,
            completion_tokens: 4,
            total_tokens: 12
          }
        },
        headers: {
          'x-request-id': 'cached-chat-stream-1'
        }
      }
    })

    const req = createReq({
      stream: true,
      messages: [{ role: 'user', content: 'hello' }]
    })
    req.path = '/v1/chat/completions'
    req.body = {
      model: 'mimo-v2-pro',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    }
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One' },
      { id: 'api-key-1' }
    )

    expect(axios).not.toHaveBeenCalled()
    const streamOutput = res.write.mock.calls.map(([chunk]) => chunk).join('')
    expect(streamOutput).toContain('"object":"chat.completion.chunk"')
    expect(streamOutput).toContain('data: [DONE]')
    expect(res.end).toHaveBeenCalled()
    expect(openaiCacheChainService.recordCacheReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'hit',
        source: 'l1'
      })
    )
  })

  it('stores cacheable upstream responses through the unified chain service', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'miss',
      source: 'upstream',
      l1Decision: {
        kind: 'bypass',
        reason: 'cache_disabled'
      },
      l2Decision: {
        kind: 'miss',
        tenantId: 'api-key-1'
      }
    })
    axios.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'upstream-1'
      },
      data: {
        id: 'resp_1',
        model: 'gpt-5',
        output: [{ type: 'output_text', text: 'hello' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        }
      }
    })

    const req = createReq()
    const res = createRes()

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One', dailyQuota: '0' },
      { id: 'api-key-1' }
    )

    expect(openaiCacheChainService.storeUpstreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'miss',
        l2Decision: expect.objectContaining({
          tenantId: 'api-key-1'
        })
      }),
      expect.objectContaining({
        statusCode: 200,
        body: expect.objectContaining({
          id: 'resp_1'
        }),
        headers: expect.objectContaining({
          'x-request-id': 'upstream-1'
        }),
        actualModel: 'gpt-5'
      })
    )
  })

  it('captures and stores completed stream responses after bypassing lookup', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'bypass',
      source: 'upstream',
      l1Decision: {
        kind: 'bypass',
        reason: 'stream_request'
      },
      l2Decision: {
        kind: 'bypass',
        reason: 'stream_request'
      }
    })
    openaiCacheChainService.prepareStreamWriteback.mockResolvedValue({
      kind: 'upstream',
      source: 'upstream',
      l1Decision: {
        kind: 'miss',
        cacheKey: 'stream-l1-key'
      },
      l2Decision: {
        kind: 'miss',
        tenantId: 'api-key-1',
        queryEmbedding: [0.1, 0.2]
      }
    })

    const streamHandlers = {}
    axios.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'stream-1'
      },
      data: {
        pipe: jest.fn(),
        on: jest.fn((event, handler) => {
          streamHandlers[event] = handler
        })
      }
    })

    const req = createReq({
      stream: true,
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
    })
    req.on = jest.fn()
    const res = createRes()

    const promise = openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One', dailyQuota: '0' },
      { id: 'api-key-1' }
    )

    await new Promise((resolve) => setImmediate(resolve))

    expect(openaiCacheChainService.prepareStreamWriteback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'bypass'
      }),
      expect.objectContaining({
        isStream: true,
        tenantId: 'api-key-1',
        requestBody: {
          model: 'gpt-5',
          stream: true,
          input: 'hello',
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

    streamHandlers.data(
      Buffer.from(
        'data: {"type":"response.completed","response":{"id":"resp_stream_1","object":"response","status":"completed","model":"gpt-5","output":[{"type":"message","id":"msg_1","status":"completed","role":"assistant","content":[{"type":"output_text","text":"hello from stream"}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n'
      )
    )
    await streamHandlers.end()
    await promise

    expect(openaiCacheChainService.storeUpstreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        l1Decision: expect.objectContaining({
          kind: 'miss',
          cacheKey: 'stream-l1-key'
        })
      }),
      expect.objectContaining({
        statusCode: 200,
        body: expect.objectContaining({
          id: 'resp_stream_1',
          status: 'completed'
        }),
        actualModel: 'gpt-5',
        usage: expect.objectContaining({
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15
        })
      })
    )
  })

  it('rebuilds passthrough stream payloads from output items before caching', async () => {
    openaiCacheChainService.beginRequest.mockResolvedValue({
      kind: 'miss',
      source: 'upstream',
      l1Decision: {
        kind: 'miss',
        cacheKey: 'stream-l1-key'
      },
      l2Decision: {
        kind: 'miss',
        tenantId: 'api-key-1',
        queryEmbedding: [0.1, 0.2]
      }
    })
    openaiCacheChainService.prepareStreamWriteback.mockImplementation(async (decision) => decision)

    const streamHandlers = {}
    axios.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {
        'x-request-id': 'stream-2'
      },
      data: {
        pipe: jest.fn(),
        on: jest.fn((event, handler) => {
          streamHandlers[event] = handler
        })
      }
    })

    const req = createReq({
      stream: true
    })
    req.on = jest.fn()
    const res = createRes()

    const promise = openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses One', dailyQuota: '0' },
      { id: 'api-key-1' }
    )

    await new Promise((resolve) => setImmediate(resolve))

    streamHandlers.data(
      Buffer.from(
        'data: {"type":"response.created","response":{"id":"resp_stream_2","object":"response","created_at":"2026-04-08T00:00:00.000Z","status":"in_progress","model":"gpt-5","output":[]}}\n\n'
      )
    )
    streamHandlers.data(
      Buffer.from(
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_2","status":"completed","role":"assistant","content":[{"type":"output_text","text":"hello rebuilt"}]}}\n\n'
      )
    )
    streamHandlers.data(
      Buffer.from(
        'data: {"type":"response.completed","response":{"id":"resp_stream_2","object":"response","created_at":"2026-04-08T00:00:00.000Z","status":"completed","model":"gpt-5","output":[],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n'
      )
    )
    await streamHandlers.end()
    await promise

    expect(openaiCacheChainService.storeUpstreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        l1Decision: expect.objectContaining({
          cacheKey: 'stream-l1-key'
        })
      }),
      expect.objectContaining({
        body: expect.objectContaining({
          id: 'resp_stream_2',
          output: [
            expect.objectContaining({
              type: 'message',
              content: [expect.objectContaining({ text: 'hello rebuilt' })]
            })
          ]
        })
      })
    )
  })
})
