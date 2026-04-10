jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  getMappedModel: jest.fn((mapping, model) => model),
  updateAccount: jest.fn(),
  updateAccountUsage: jest.fn(),
  updateUsageQuota: jest.fn()
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

const EventEmitter = require('events')
const { Readable } = require('stream')
const axios = require('axios')
const apiKeyService = require('../src/services/apiKeyService')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')
const { buildTokenCacheRequestContext } = require('../src/services/tokenCache/tokenCacheProvider')
const {
  buildResponsesClientAttempts
} = require('../src/services/openaiProtocol/upstreamProtocolHelper')

describe('openaiResponsesRelayService token cache hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesRelayService.setTokenCacheProvider(null)
  })

  afterAll(() => {
    openaiResponsesRelayService.setTokenCacheProvider(null)
  })

  it('builds a stable token cache context from prompt_cache_key', () => {
    const context = buildTokenCacheRequestContext({
      req: {
        headers: {},
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key',
          conversation_id: 'conv-1'
        }
      },
      attempt: {
        path: '/responses',
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key'
        }
      },
      account: {
        id: 'responses-1',
        name: 'Responses Primary'
      }
    })

    expect(context).toEqual(
      expect.objectContaining({
        accountId: 'responses-1',
        accountName: 'Responses Primary',
        endpointPath: '/responses',
        requestedModel: 'gpt-5.3-codex',
        promptCacheKey: 'relay-cache-key',
        sessionKey: 'conv-1',
        conversationId: 'conv-1',
        isStream: false
      })
    )
    expect(context.sessionHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('tracks client stream intent separately from upstream stream normalization', () => {
    const context = buildTokenCacheRequestContext({
      req: {
        headers: {},
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key',
          stream: false
        }
      },
      attempt: {
        path: '/responses',
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key',
          stream: true
        }
      },
      clientStream: false,
      account: {
        id: 'responses-1',
        name: 'Responses Primary'
      }
    })

    expect(context.isStream).toBe(false)
    expect(context.requestBody).toEqual({
      model: 'gpt-5.3-codex',
      prompt_cache_key: 'relay-cache-key',
      stream: false
    })
  })

  it('serves a token cache hit before forwarding upstream', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses Primary',
      apiKey: 'upstream-key',
      baseApi: 'https://example.com',
      modelMapping: null,
      supportedModels: null
    })

    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockResolvedValue({
        hit: true,
        statusCode: 200,
        body: { id: 'resp_cached' },
        headers: {
          'x-token-cache': 'HIT'
        }
      }),
      store: jest.fn()
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const req = {
      headers: {},
      body: {
        model: 'gpt-5.3-codex',
        prompt_cache_key: 'relay-cache-key'
      },
      path: '/responses',
      method: 'POST',
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn()
    }

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(provider.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'responses-1',
        promptCacheKey: 'relay-cache-key'
      })
    )
    expect(axios).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id: 'resp_cached' })
  })

  it('replays cached stream hits as SSE without forwarding upstream', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses Primary',
      apiKey: 'upstream-key',
      baseApi: 'https://example.com',
      modelMapping: null,
      supportedModels: null
    })

    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockResolvedValue({
        hit: true,
        statusCode: 200,
        body: {
          id: 'resp_cached_stream',
          object: 'response',
          created_at: '2026-04-09T00:00:00.000Z',
          status: 'completed',
          model: 'gpt-5.3-codex',
          output: [
            {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'A cached streamed answer' }]
            }
          ]
        },
        headers: {
          'x-token-cache': 'HIT'
        }
      }),
      store: jest.fn()
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const req = {
      headers: {},
      body: {
        model: 'gpt-5.3-codex',
        prompt_cache_key: 'relay-cache-key',
        stream: true
      },
      path: '/responses',
      method: 'POST',
      once: jest.fn(),
      removeListener: jest.fn()
    }
    const res = {
      once: jest.fn(),
      removeListener: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    }

    await openaiResponsesRelayService.handleRequest(
      req,
      res,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(axios).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(res.status).toHaveBeenCalledWith(200)
    const writtenChunks = res.write.mock.calls.map(([chunk]) => String(chunk))
    expect(writtenChunks).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"response.created"'),
        expect.stringContaining('"type":"response.output_item.done"'),
        expect.stringContaining('A cached streamed answer'),
        expect.stringContaining('"type":"response.completed"')
      ])
    )
    expect(writtenChunks.join('\n')).not.toContain('"type":"response.output_text.delta"')
    expect(res.end).toHaveBeenCalled()
  })

  it('stores successful non-stream responses through the token cache provider', async () => {
    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockResolvedValue({ hit: false }),
      store: jest.fn().mockResolvedValue({ stored: true })
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const tokenCacheContext = buildTokenCacheRequestContext({
      req: {
        headers: {},
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key'
        }
      },
      attempt: {
        path: '/responses',
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key'
        }
      },
      account: {
        id: 'responses-1'
      }
    })

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }

    await openaiResponsesRelayService._handleNormalResponse(
      {
        status: 200,
        headers: {},
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
        promptCacheKey: 'relay-cache-key'
      },
      tokenCacheContext
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
      expect.objectContaining({
        promptCacheKey: 'relay-cache-key',
        stream: false,
        statusCode: 200
      })
    )
    expect(provider.store).toHaveBeenCalledWith(
      tokenCacheContext,
      expect.objectContaining({
        statusCode: 200,
        streamed: false,
        body: expect.objectContaining({
          model: 'gpt-5.3-codex'
        })
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('does not store non-200 responses in the token cache', async () => {
    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockResolvedValue({ hit: false }),
      store: jest.fn().mockResolvedValue({ stored: true })
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const tokenCacheContext = buildTokenCacheRequestContext({
      req: {
        headers: {},
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key'
        }
      },
      attempt: {
        path: '/responses',
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key'
        }
      },
      account: {
        id: 'responses-1'
      }
    })

    await expect(
      openaiResponsesRelayService._storeTokenCacheResponse(tokenCacheContext, {
        statusCode: 202,
        body: { id: 'resp_pending' }
      })
    ).resolves.toBeNull()

    expect(provider.store).not.toHaveBeenCalled()
  })

  it('reuses the client token cache context when protocol fallback succeeds upstream', async () => {
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses Primary',
      apiKey: 'upstream-key',
      baseApi: 'https://example.com',
      providerEndpoint: 'responses',
      modelMapping: null,
      supportedModels: null
    })

    let storedRecord = null
    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockImplementation(async (context) => {
        if (
          storedRecord &&
          context.endpointPath === storedRecord.context.endpointPath &&
          JSON.stringify(context.requestBody) === JSON.stringify(storedRecord.context.requestBody)
        ) {
          return {
            hit: true,
            statusCode: storedRecord.response.statusCode,
            body: storedRecord.response.body,
            headers: {
              'x-token-cache': 'HIT'
            }
          }
        }

        return { hit: false }
      }),
      store: jest.fn().mockImplementation(async (context, response) => {
        storedRecord = { context, response }
        return { stored: true }
      })
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    axios
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: {
          id: 'chatcmpl_fallback_1',
          object: 'chat.completion',
          created: 1712620800,
          model: 'mimo-v2-pro',
          choices: [
            {
              index: 0,
              finish_reason: 'length',
              message: {
                reasoning_content: 'Reasoning',
                content: 'CACHE_TEST'
              }
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            completion_tokens_details: {
              reasoning_tokens: 4
            }
          }
        }
      })

    const buildReq = () => ({
      headers: {
        'user-agent': 'codex_cli_rs/0.43.0'
      },
      body: {
        model: 'mimo-v2-pro',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Reply with exactly CACHE_TEST and nothing else.' }
            ]
          }
        ],
        temperature: 0,
        max_output_tokens: 16,
        stream: false
      },
      path: '/v1/responses',
      method: 'POST',
      once: jest.fn(),
      removeListener: jest.fn()
    })

    const buildRes = () => ({
      once: jest.fn(),
      removeListener: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn()
    })

    await openaiResponsesRelayService.handleRequest(
      buildReq(),
      buildRes(),
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' },
      {
        attempts: buildResponsesClientAttempts({
          path: '/v1/responses',
          body: buildReq().body,
          requestedModel: 'mimo-v2-pro',
          providerEndpoint: 'responses'
        })
      }
    )

    expect(provider.store).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/responses'
      }),
      expect.any(Object)
    )
    expect(storedRecord?.context?.endpointPath).toBe('/v1/responses')
    expect(axios).toHaveBeenCalledTimes(2)

    const hitRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(),
      hitRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' },
      {
        attempts: buildResponsesClientAttempts({
          path: '/v1/responses',
          body: buildReq().body,
          requestedModel: 'mimo-v2-pro',
          providerEndpoint: 'responses'
        })
      }
    )

    expect(provider.lookup).toHaveBeenLastCalledWith(
      expect.objectContaining({
        endpointPath: '/v1/responses'
      })
    )
    expect(hitRes.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(hitRes.status).toHaveBeenCalledWith(200)
    expect(hitRes.json).toHaveBeenCalledWith(storedRecord.response.body)
    expect(axios).toHaveBeenCalledTimes(2)
  })

  it('stores successful stream responses through the token cache provider after completion', async () => {
    const provider = {
      getName: jest.fn().mockReturnValue('test-cache'),
      lookup: jest.fn().mockResolvedValue({ hit: false }),
      store: jest.fn().mockResolvedValue({ stored: true })
    }
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const req = new EventEmitter()
    req.headers = {}
    req.body = {
      model: 'gpt-5.3-codex',
      prompt_cache_key: 'relay-cache-key',
      stream: true
    }
    req._serviceTier = null

    const tokenCacheContext = buildTokenCacheRequestContext({
      req,
      attempt: {
        path: '/responses',
        body: {
          model: 'gpt-5.3-codex',
          prompt_cache_key: 'relay-cache-key',
          stream: true
        }
      },
      clientStream: true,
      account: {
        id: 'responses-1'
      }
    })

    let resolveEnd
    const streamEnded = new Promise((resolve) => {
      resolveEnd = resolve
    })
    const res = {
      destroyed: false,
      headersSent: false,
      setHeader: jest.fn(),
      write: jest.fn(),
      end: jest.fn(() => resolveEnd()),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      removeListener: jest.fn()
    }

    await openaiResponsesRelayService._handleStreamResponse(
      {
        status: 200,
        headers: {},
        data: Readable.from([
          'data: {"type":"response.created","response":{"id":"resp_stream_1","object":"response","created_at":"2026-04-09T00:00:00.000Z","status":"in_progress","model":"gpt-5.3-codex","output":[]}}\n\n',
          'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"A streamed answer","annotations":[]}]}}\n\n',
          'data: {"type":"response.completed","response":{"id":"resp_stream_1","object":"response","created_at":"2026-04-09T00:00:00.000Z","status":"completed","model":"gpt-5.3-codex","output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"A streamed answer","annotations":[]}]}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n'
        ])
      },
      res,
      { id: 'responses-1', dailyQuota: '0' },
      { id: 'key-1' },
      'gpt-5.3-codex',
      jest.fn(),
      req,
      {
        promptCacheKey: 'relay-cache-key'
      },
      null,
      tokenCacheContext,
      null
    )

    await streamEnded

    expect(provider.store).toHaveBeenCalledWith(
      tokenCacheContext,
      expect.objectContaining({
        statusCode: 200,
        streamed: true,
        body: expect.objectContaining({
          id: 'resp_stream_1',
          model: 'gpt-5.3-codex',
          status: 'completed'
        })
      })
    )
    expect(res.end).toHaveBeenCalled()
  })
})
