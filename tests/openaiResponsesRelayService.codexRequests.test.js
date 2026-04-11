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

const axios = require('axios')
const CodexToOpenAIConverter = require('../src/services/codexToOpenAI')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiResponsesRelayService = require('../src/services/relay/openaiResponsesRelayService')
const PromptCacheTokenCacheProvider = require('../src/services/tokenCache/promptCacheTokenCacheProvider')

class MemoryTokenCacheStorage {
  constructor() {
    this.data = new Map()
  }

  _buildKey(kind, key) {
    return `${kind}:${key}`
  }

  async set(kind, key, value) {
    this.data.set(this._buildKey(kind, key), value)
  }

  async get(kind, key) {
    return this.data.get(this._buildKey(kind, key)) || null
  }

  async delete(key) {
    this.data.delete(this._buildKey('entry', key))
    this.data.delete(this._buildKey('prompt', key))
  }
}

function buildCodexResponsesBody(overrides = {}) {
  const converter = new CodexToOpenAIConverter()
  return converter.buildRequestFromOpenAI({
    model: 'gpt-5',
    stream: false,
    temperature: 0,
    ...overrides
  })
}

function buildSearchTool(name = 'mcp__workspace__search_files') {
  return {
    type: 'function',
    function: {
      name,
      description: 'Search the workspace for matching files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }
}

function buildReq(body, headers = {}) {
  return {
    headers: {
      'user-agent': 'codex_cli_rs/0.43.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
      ...headers
    },
    body,
    path: '/v1/responses',
    method: 'POST',
    once: jest.fn(),
    removeListener: jest.fn()
  }
}

function buildRes() {
  return {
    once: jest.fn(),
    removeListener: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    send: jest.fn(),
    write: jest.fn(),
    end: jest.fn()
  }
}

function buildSuccessResponse({ id, outputText, usage }) {
  return {
    status: 200,
    headers: {},
    data: {
      id,
      object: 'response',
      status: 'completed',
      model: 'gpt-5',
      output: [
        {
          id: `${id}_msg`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: outputText }]
        }
      ],
      usage
    }
  }
}

function buildToolCallResponse({ id, callId, toolName, argumentsJson, usage }) {
  return {
    status: 200,
    headers: {},
    data: {
      id,
      object: 'response',
      status: 'completed',
      model: 'gpt-5',
      output: [
        {
          id: `${id}_fc`,
          type: 'function_call',
          call_id: callId,
          name: toolName,
          arguments: argumentsJson
        }
      ],
      usage
    }
  }
}

describe('openaiResponsesRelayService codex request simulation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesRelayService.setTokenCacheProvider(null)
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      name: 'Responses Primary',
      apiKey: 'upstream-key',
      baseApi: 'https://example.com',
      providerEndpoint: 'responses',
      modelMapping: null,
      supportedModels: null,
      dailyQuota: '0'
    })
  })

  afterAll(() => {
    openaiResponsesRelayService.setTokenCacheProvider(null)
  })

  it('serves repeated ultra-long codex requests from cache on the second pass', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const ultraLongPrompt = Array.from(
      { length: 4096 },
      (_, index) => `Segment ${index} keeps the Codex cache path deterministic.`
    ).join(' ')
    const requestBody = buildCodexResponsesBody({
      messages: [{ role: 'user', content: ultraLongPrompt }],
      prompt_cache_key: 'codex-long-request'
    })

    axios.mockResolvedValueOnce(
      buildSuccessResponse({
        id: 'resp_long_1',
        outputText: 'LONG_CACHE_OK',
        usage: {
          input_tokens: 180000,
          output_tokens: 3,
          total_tokens: 180003
        }
      })
    )

    const firstRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      firstRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(firstRes.status).toHaveBeenCalledWith(200)
    expect(storage.data.size).toBeGreaterThan(0)

    const secondRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      secondRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(axios).toHaveBeenCalledTimes(1)
    expect(secondRes.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(secondRes.setHeader).toHaveBeenCalledWith('x-token-cache-layer', 'exact')
    expect(secondRes.status).toHaveBeenCalledWith(200)
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'resp_long_1'
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        stores: 1
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        exactHits: 1
      })
    )
  })

  it('exact-caches terminal post-tool codex conversations once the request is replay-safe', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const requestBody = buildCodexResponsesBody({
      messages: [
        { role: 'user', content: 'Search the repo for token cache hooks.' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_search_1',
              type: 'function',
              function: {
                name: 'mcp__workspace__search_files',
                arguments: JSON.stringify({ query: 'token cache hooks' })
              }
            }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'call_search_1',
          content: JSON.stringify({
            matches: ['src/services/tokenCache/requestTextExtractor.js']
          })
        },
        { role: 'user', content: 'Summarize the results.' }
      ],
      tools: [buildSearchTool()],
      tool_choice: 'auto',
      prompt_cache_key: 'codex-tool-request'
    })

    axios.mockResolvedValue(
      buildSuccessResponse({
        id: 'resp_tool_1',
        outputText: 'TOOL_CALL_READY',
        usage: {
          input_tokens: 512,
          output_tokens: 32,
          total_tokens: 544
        }
      })
    )

    const firstRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      firstRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(storage.data.size).toBeGreaterThan(0)

    const secondRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      secondRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(axios).toHaveBeenCalledTimes(1)
    expect(secondRes.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(secondRes.setHeader).toHaveBeenCalledWith('x-token-cache-layer', 'exact')
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        exactHits: 1
      })
    )
  })

  it('bypasses token cache for opaque codex responses traffic keyed only by session headers', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const requestBody = buildCodexResponsesBody({
      messages: [{ role: 'user', content: 'Reply with SESSION_HEADER_SAFE.' }],
      prompt_cache_key: 'codex-session-request'
    })
    const requestHeaders = {
      session_id: 'codex-session-header-1'
    }

    axios
      .mockResolvedValueOnce(
        buildSuccessResponse({
          id: 'resp_session_1',
          outputText: 'SESSION_HEADER_SAFE',
          usage: {
            input_tokens: 64,
            output_tokens: 4,
            total_tokens: 68
          }
        })
      )
      .mockResolvedValueOnce(
        buildSuccessResponse({
          id: 'resp_session_2',
          outputText: 'SESSION_HEADER_SAFE',
          usage: {
            input_tokens: 64,
            output_tokens: 4,
            total_tokens: 68
          }
        })
      )

    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody, requestHeaders),
      buildRes(),
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody, requestHeaders),
      buildRes(),
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(storage.data.size).toBe(0)
    expect(axios).toHaveBeenCalledTimes(2)
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: 1,
        bypasses: 1,
        'bypassReason:stateful_unanchored': 1
      })
    )
  })

  it('exact-caches codex responses traffic when previous_response_id provides a turn anchor', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const requestBody = {
      model: 'gpt-5',
      previous_response_id: 'resp_prev_1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Reply with ANCHORED_CACHE_OK.' }]
        }
      ],
      stream: false
    }

    axios.mockResolvedValueOnce(
      buildSuccessResponse({
        id: 'resp_anchored_1',
        outputText: 'ANCHORED_CACHE_OK',
        usage: {
          input_tokens: 64,
          output_tokens: 4,
          total_tokens: 68
        }
      })
    )

    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody, { session_id: 'codex-session-header-1' }),
      buildRes(),
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    const hitRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody, { session_id: 'codex-session-header-1' }),
      hitRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(axios).toHaveBeenCalledTimes(1)
    expect(hitRes.setHeader).toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(hitRes.setHeader).toHaveBeenCalledWith('x-token-cache-layer', 'exact')
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        stores: 1
      })
    )
  })

  it('does not store codex responses that only contain tool calls', async () => {
    const storage = new MemoryTokenCacheStorage()
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics: {
        recordAsync: jest.fn()
      },
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    openaiResponsesRelayService.setTokenCacheProvider(provider)

    const requestBody = buildCodexResponsesBody({
      messages: [{ role: 'user', content: 'Search the repo for token cache hooks.' }],
      tools: [buildSearchTool()],
      tool_choice: 'auto',
      prompt_cache_key: 'codex-pre-tool-request'
    })

    axios
      .mockResolvedValueOnce(
        buildToolCallResponse({
          id: 'resp_tool_call_1',
          callId: 'call_search_1',
          toolName: 'mcp__workspace__search_files',
          argumentsJson: JSON.stringify({ query: 'token cache hooks' }),
          usage: {
            input_tokens: 128,
            output_tokens: 16,
            total_tokens: 144
          }
        })
      )
      .mockResolvedValueOnce(
        buildToolCallResponse({
          id: 'resp_tool_call_2',
          callId: 'call_search_1',
          toolName: 'mcp__workspace__search_files',
          argumentsJson: JSON.stringify({ query: 'token cache hooks' }),
          usage: {
            input_tokens: 128,
            output_tokens: 16,
            total_tokens: 144
          }
        })
      )

    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      buildRes(),
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    const secondRes = buildRes()
    await openaiResponsesRelayService.handleRequest(
      buildReq(requestBody),
      secondRes,
      { id: 'responses-1', name: 'Responses Primary' },
      { id: 'key-1' }
    )

    expect(storage.data.size).toBe(0)
    expect(axios).toHaveBeenCalledTimes(2)
    expect(secondRes.setHeader).not.toHaveBeenCalledWith('x-token-cache', 'HIT')
    expect(secondRes.status).toHaveBeenCalledWith(200)
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'resp_tool_call_2'
      })
    )
  })
})
