jest.mock('../src/models/redis', () => ({
  getOpenAIL1CacheEntry: jest.fn(),
  setOpenAIL1CacheEntry: jest.fn(),
  acquireOpenAIL1CacheLock: jest.fn(),
  releaseOpenAIL1CacheLock: jest.fn(),
  incrementOpenAIL1CacheMetric: jest.fn(),
  incrementOpenAIL1CacheBypassReason: jest.fn()
}))

const config = require('../config/config')
const redis = require('../src/models/redis')
const openaiL1CacheService = require('../src/services/cache/openaiL1CacheService')

describe('openaiL1CacheService', () => {
  const baseContext = {
    tenantId: 'api-key-1',
    provider: 'openai',
    endpoint: 'responses',
    requestHeaders: {
      'openai-beta': 'assistants=v2'
    },
    requestBody: {
      model: 'gpt-5',
      input: '  hello world  ',
      temperature: 0.2,
      stream: false
    },
    resolvedModel: 'gpt-5',
    isStream: false
  }

  beforeEach(() => {
    jest.clearAllMocks()
    config.openaiCache = {
      enabled: true,
      defaultTtlSeconds: 86400,
      embeddingsTtlSeconds: 604800,
      lockTtlSeconds: 15,
      waitTimeoutMs: 25,
      waitPollMs: 1,
      maxCacheableTemperature: 0.3
    }
  })

  it('builds the same cache key for equivalent normalized requests', () => {
    const first = openaiL1CacheService.buildCachePlan(baseContext)
    const second = openaiL1CacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        model: 'gpt-5',
        input: 'hello world',
        temperature: '0.2',
        stream: false,
        prompt_cache_key: 'ephemeral-key'
      }
    })

    expect(first.cacheable).toBe(true)
    expect(second.cacheable).toBe(true)
    expect(first.cacheKey).toBe(second.cacheKey)
  })

  it('bypasses stream requests', () => {
    const plan = openaiL1CacheService.buildCachePlan({
      ...baseContext,
      isStream: true,
      requestBody: {
        ...baseContext.requestBody,
        stream: true
      }
    })

    expect(plan).toEqual({
      cacheable: false,
      reason: 'stream_request'
    })
  })

  it('allows stream lookups when the caller explicitly opts in to replay support', () => {
    const plan = openaiL1CacheService.buildCachePlan({
      ...baseContext,
      isStream: true,
      allowStreamLookup: true,
      requestBody: {
        ...baseContext.requestBody,
        stream: true
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.cacheKey).toContain('cache:openai:l1:v1:api-key-1:openai:responses:')
  })

  it('bypasses tool-enabled requests', () => {
    const plan = openaiL1CacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        tools: [{ type: 'function', function: { name: 'search' } }]
      }
    })

    expect(plan).toEqual({
      cacheable: false,
      reason: 'dynamic_tools'
    })
  })

  it('records bypass reason metrics when a request is skipped before lookup', async () => {
    const result = await openaiL1CacheService.beginRequest({
      ...baseContext,
      isStream: true,
      requestBody: {
        ...baseContext.requestBody,
        stream: true
      }
    })

    expect(result).toEqual({
      kind: 'bypass',
      reason: 'stream_request'
    })
    expect(redis.incrementOpenAIL1CacheMetric).toHaveBeenCalledWith('cache_bypass')
    expect(redis.incrementOpenAIL1CacheBypassReason).toHaveBeenCalledWith('stream_request')
  })

  it('returns a cache hit when Redis already has the response', async () => {
    redis.getOpenAIL1CacheEntry.mockResolvedValue({
      statusCode: 200,
      body: { id: 'cached-response' },
      headers: { 'x-request-id': 'cached-1' }
    })

    const result = await openaiL1CacheService.beginRequest(baseContext)

    expect(result.kind).toBe('hit')
    expect(result.entry).toMatchObject({
      statusCode: 200,
      body: { id: 'cached-response' }
    })
    expect(redis.acquireOpenAIL1CacheLock).not.toHaveBeenCalled()
    expect(redis.incrementOpenAIL1CacheMetric).toHaveBeenCalledWith('cache_hit_exact')
  })

  it('waits for an in-flight request and reuses the populated cache entry', async () => {
    redis.getOpenAIL1CacheEntry
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { id: 'filled-by-other-request' },
        headers: {}
      })
    redis.acquireOpenAIL1CacheLock.mockResolvedValue(false)

    const result = await openaiL1CacheService.beginRequest(baseContext)

    expect(result.kind).toBe('hit')
    expect(result.entry.body).toEqual({ id: 'filled-by-other-request' })
    expect(redis.incrementOpenAIL1CacheMetric).toHaveBeenCalledWith('cache_hit_exact')
  })

  it('returns a miss with a reservation when no cache entry exists', async () => {
    redis.getOpenAIL1CacheEntry.mockResolvedValue(null)
    redis.acquireOpenAIL1CacheLock.mockResolvedValue(true)

    const result = await openaiL1CacheService.beginRequest(baseContext)

    expect(result.kind).toBe('miss')
    expect(result.lockAcquired).toBe(true)
    expect(result.cacheKey).toContain('cache:openai:l1:v1:api-key-1:openai:responses:')
    expect(redis.incrementOpenAIL1CacheMetric).toHaveBeenCalledWith('cache_miss')
  })

  it('builds a capture decision for stream responses without acquiring a lock', async () => {
    const result = await openaiL1CacheService.createCaptureDecision({
      ...baseContext,
      isStream: true,
      requestBody: {
        ...baseContext.requestBody,
        stream: true
      }
    })

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'miss',
        lockAcquired: false,
        captureOnly: true
      })
    )
    expect(result.cacheKey).toContain('cache:openai:l1:v1:api-key-1:openai:responses:')
  })

  it('stores successful non-stream responses with endpoint-specific ttl', async () => {
    const miss = {
      kind: 'miss',
      cacheKey: 'cache:openai:l1:v1:api-key-1:azure-openai:embeddings:hash',
      ttlSeconds: 604800
    }

    const result = await openaiL1CacheService.storeResponse(miss, {
      statusCode: 200,
      body: {
        object: 'list',
        data: [{ embedding: [0.1, 0.2] }]
      },
      headers: {
        'x-request-id': 'req-1',
        'content-length': '123'
      },
      actualModel: 'text-embedding-3-small'
    })

    expect(result).toEqual({ stored: true })
    expect(redis.setOpenAIL1CacheEntry).toHaveBeenCalledWith(
      'cache:openai:l1:v1:api-key-1:azure-openai:embeddings:hash',
      expect.objectContaining({
        statusCode: 200,
        body: {
          object: 'list',
          data: [{ embedding: [0.1, 0.2] }]
        },
        headers: {
          'x-request-id': 'req-1'
        },
        actualModel: 'text-embedding-3-small'
      }),
      604800
    )
    expect(redis.incrementOpenAIL1CacheMetric).toHaveBeenCalledWith('cache_write')
  })

  it('replays cached responses through the Express response object', () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    }

    openaiL1CacheService.replayCachedResponse(res, {
      statusCode: 200,
      body: { id: 'cached-response' },
      headers: {
        'x-request-id': 'cached-1'
      }
    })

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'cached-1')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ id: 'cached-response' })
  })
})
