jest.mock('../src/models/redis', () => ({
  getOpenAIL3CacheEntry: jest.fn(),
  setOpenAIL3CacheEntry: jest.fn(),
  acquireOpenAIL3CacheLock: jest.fn(),
  releaseOpenAIL3CacheLock: jest.fn(),
  incrementOpenAIL3CacheMetric: jest.fn(),
  incrementOpenAIL3CacheBypassReason: jest.fn()
}))

const config = require('../config/config')
const redis = require('../src/models/redis')
const openaiL3GlobalCacheService = require('../src/services/cache/openaiL3GlobalCacheService')

describe('openaiL3GlobalCacheService', () => {
  const baseContext = {
    provider: 'openai',
    endpoint: 'responses',
    requestHeaders: {
      'openai-beta': 'assistants=v2'
    },
    requestBody: {
      model: 'gpt-5.4',
      input: '  hello world  ',
      temperature: 0.2,
      stream: false
    },
    resolvedModel: 'gpt-5.4',
    isStream: false
  }

  beforeEach(() => {
    jest.clearAllMocks()
    config.openaiCache = {
      ...(config.openaiCache || {}),
      l3: {
        enabled: true,
        defaultTtlSeconds: 3600,
        embeddingsTtlSeconds: 604800,
        lockTtlSeconds: 15,
        waitTimeoutMs: 25,
        waitPollMs: 1,
        maxCacheableTemperature: 0.3
      }
    }
  })

  it('builds the same global cache key for equivalent normalized requests', () => {
    const first = openaiL3GlobalCacheService.buildCachePlan(baseContext)
    const second = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        model: 'gpt-5.4',
        input: 'hello world',
        temperature: '0.2',
        stream: false,
        prompt_cache_key: 'ephemeral-key'
      }
    })

    expect(first.cacheable).toBe(true)
    expect(second.cacheable).toBe(true)
    expect(first.cacheKey).toBe(second.cacheKey)
    expect(first.cacheKey).toContain('cache:openai:l3:v1:openai:responses:')
  })

  it('keeps equivalent responses input shapes on the same global cache key', () => {
    const first = openaiL3GlobalCacheService.buildCachePlan(baseContext)
    const second = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        model: 'gpt-5.4',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: ' hello world ' }]
          }
        ],
        temperature: 0.2,
        stream: false
      }
    })

    expect(first.cacheable).toBe(true)
    expect(second.cacheable).toBe(true)
    expect(first.cacheKey).toBe(second.cacheKey)
  })

  it('ignores default text format and request noise when building the global cache key', () => {
    const first = openaiL3GlobalCacheService.buildCachePlan(baseContext)
    const second = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        text: {
          format: {
            type: 'text'
          }
        },
        store: true,
        metadata: {},
        user: 'end-user-1',
        service_tier: 'auto',
        safety_identifier: 'sid-1',
        prompt_cache_retention: {
          type: 'ephemeral',
          ttl_seconds: 86400
        },
        tools: []
      }
    })

    expect(first.cacheable).toBe(true)
    expect(second.cacheable).toBe(true)
    expect(first.cacheKey).toBe(second.cacheKey)
  })

  it('treats implicit function tools as cacheable global-cache candidates', () => {
    const plan = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        tools: [
          {
            name: 'shell_command',
            description: 'Run a terminal command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' }
              }
            }
          }
        ],
        tool_choice: {
          name: 'shell_command'
        }
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.cacheKey).toContain('cache:openai:l3:v1:openai:responses:')
  })

  it('allows Codex-style custom and web search tools to participate in global cache', () => {
    const plan = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'check cache bypass details' }]
          },
          {
            type: 'function_call',
            name: 'shell_command',
            arguments: '{ "command": "rg tool_custom service.log" }'
          },
          {
            type: 'function_call_output',
            output: {
              exit_code: 0,
              stdout: 'OpenAI L3 cache bypass detail'
            }
          },
          {
            type: 'custom_tool_call',
            name: 'apply_patch',
            input: '*** Begin Patch'
          },
          {
            type: 'custom_tool_call_output',
            output: 'Success'
          },
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'internal' }]
          }
        ],
        tools: [
          {
            type: 'function',
            name: 'shell_command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' }
              }
            }
          },
          {
            type: 'custom',
            name: 'apply_patch',
            format: {
              type: 'grammar',
              syntax: 'lark',
              definition: 'start: "patch"'
            }
          },
          {
            type: 'web_search',
            search_context_size: 'medium',
            external_web_access: true
          }
        ]
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.cacheKey).toContain('cache:openai:l3:v1:openai:responses:')
  })

  it('bypasses unsupported tool types with a specific reason', () => {
    const plan = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        tools: [{ type: 'computer_use_preview' }]
      }
    })

    expect(plan).toEqual({
      cacheable: false,
      reason: 'tool_computer_use_preview'
    })
  })

  it('bypasses request-level dynamic search options with a specific reason', () => {
    const plan = openaiL3GlobalCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        web_search_options: {
          search_context_size: 'high'
        }
      }
    })

    expect(plan).toEqual({
      cacheable: false,
      reason: 'request_web_search_options'
    })
  })

  it('does not require tenant id for global cache plans', () => {
    const plan = openaiL3GlobalCacheService.buildCachePlan(baseContext)

    expect(plan.cacheable).toBe(true)
    expect(plan.cacheKey).not.toContain('api-key-1')
  })

  it('returns a hit when a cached entry already exists', async () => {
    redis.getOpenAIL3CacheEntry.mockResolvedValue({
      statusCode: 200,
      body: { id: 'cached' }
    })

    const result = await openaiL3GlobalCacheService.beginRequest(baseContext)

    expect(result).toEqual({
      kind: 'hit',
      entry: {
        statusCode: 200,
        body: { id: 'cached' }
      },
      cacheKey: expect.any(String)
    })
    expect(redis.incrementOpenAIL3CacheMetric).toHaveBeenCalledWith('cache_hit_exact')
    expect(redis.acquireOpenAIL3CacheLock).not.toHaveBeenCalled()
  })

  it('returns a miss and acquires a lock when no cached entry exists', async () => {
    redis.getOpenAIL3CacheEntry.mockResolvedValue(null)
    redis.acquireOpenAIL3CacheLock.mockResolvedValue(true)

    const result = await openaiL3GlobalCacheService.beginRequest(baseContext)

    expect(result.kind).toBe('miss')
    expect(result.cacheKey).toContain('cache:openai:l3:v1:openai:responses:')
    expect(result.lockKey).toContain('lock:openai:l3:v1:openai:responses:')
    expect(redis.incrementOpenAIL3CacheMetric).toHaveBeenCalledWith('cache_miss')
  })

  it('stores successful upstream responses into the global cache', async () => {
    const decision = {
      kind: 'miss',
      cacheKey: 'cache:openai:l3:v1:openai:responses:abc',
      ttlSeconds: 3600
    }

    const result = await openaiL3GlobalCacheService.storeResponse(decision, {
      statusCode: 200,
      body: { id: 'resp_123' },
      headers: {
        'x-request-id': 'req_123'
      },
      actualModel: 'gpt-5.4'
    })

    expect(result).toEqual({ stored: true })
    expect(redis.setOpenAIL3CacheEntry).toHaveBeenCalledWith(
      'cache:openai:l3:v1:openai:responses:abc',
      expect.objectContaining({
        statusCode: 200,
        body: { id: 'resp_123' },
        actualModel: 'gpt-5.4'
      }),
      3600
    )
    expect(redis.incrementOpenAIL3CacheMetric).toHaveBeenCalledWith('cache_write')
  })
})
