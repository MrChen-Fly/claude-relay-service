const axios = require('axios')

jest.mock('axios', () => jest.fn())
jest.mock('../src/models/redis', () => ({
  getOpenAIL2Embedding: jest.fn(),
  getOpenAIL2Embeddings: jest.fn(),
  setOpenAIL2Embedding: jest.fn(),
  getOpenAIL2Entry: jest.fn(),
  getOpenAIL2Entries: jest.fn(),
  setOpenAIL2Entry: jest.fn(),
  addOpenAIL2IndexEntry: jest.fn(),
  getOpenAIL2CandidateKeys: jest.fn(),
  incrementOpenAIL2CacheMetric: jest.fn(),
  incrementOpenAIL2CacheBypassReason: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null),
  getProxyDescription: jest.fn(() => 'proxy')
}))
jest.mock('../src/utils/headerFilter', () => ({
  filterForOpenAI: jest.fn((headers) => headers || {})
}))

const config = require('../config/config')
const redis = require('../src/models/redis')
const openaiL2SemanticCacheService = require('../src/services/cache/openaiL2SemanticCacheService')

describe('openaiL2SemanticCacheService', () => {
  const baseContext = {
    tenantId: 'api-key-1',
    provider: 'openai-responses',
    endpoint: 'responses',
    requestHeaders: {
      'user-agent': 'jest-client'
    },
    requestBody: {
      model: 'gpt-5',
      stream: false,
      temperature: 0.2,
      instructions: '  You are helpful. ',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '  hello world  ' }]
        }
      ]
    },
    resolvedModel: 'gpt-5',
    isStream: false,
    fullAccount: {
      baseApi: 'https://relay.example.com/v1',
      apiKey: 'secret-key',
      userAgent: 'relay-agent'
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    config.openaiCache = {
      ...(config.openaiCache || {}),
      l2: {
        enabled: true,
        embeddingBaseUrl: '',
        embeddingApiKey: '',
        embeddingModel: 'text-embedding-3-small',
        similarityThreshold: 0.95,
        entryTtlSeconds: 604800,
        embeddingTtlSeconds: 2592000,
        maxCandidates: 20,
        maxIndexedEntries: 200,
        maxTextLength: 12000,
        rankAcceptanceThreshold: 0.9,
        maxCacheableTemperature: 0.3
      }
    }
  })

  it('builds a cacheable plan for pure text responses requests', () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan(baseContext)

    expect(plan.cacheable).toBe(true)
    expect(plan.model).toBe('gpt-5')
    expect(plan.queryText).toContain('system: You are helpful.')
    expect(plan.queryText).toContain('user: hello world')
    expect(plan.embeddingKey).toContain('cache:openai:l2:embed:v1:')
  })

  it('supports responses message items without an explicit type field', () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        input: [
          {
            role: 'user',
            content: '  hello world  '
          }
        ]
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.queryText).toContain('system: You are helpful.')
    expect(plan.queryText).toContain('user: hello world')
  })

  it('strips stable Codex CLI boilerplate from semantic instructions', () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        instructions:
          "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.\n\n## General\n\n- When searching for text or files, prefer using `rg`.\n\n## Editing constraints\n\n- Default to ASCII when editing or creating files.",
        input: 'hello world'
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.queryText).toBe('user: hello world')
  })

  it('supports responses message items with structured content and no type field', () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        input: [
          {
            role: 'developer',
            content: [{ type: 'input_text', text: '  keep format stable  ' }]
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: '  hello world  ' }]
          }
        ]
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.queryText).toContain('system: keep format stable')
    expect(plan.queryText).toContain('user: hello world')
  })

  it('bypasses unsupported multimodal content', () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      requestBody: {
        ...baseContext.requestBody,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_image', image_url: 'https://example.com/a.png' }]
          }
        ]
      }
    })

    expect(plan).toEqual({
      cacheable: false,
      reason: 'unsupported_content_part'
    })
  })

  it('records bypass reason metrics when semantic cache skips a request', async () => {
    const result = await openaiL2SemanticCacheService.beginRequest({
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
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('cache_bypass')
    expect(redis.incrementOpenAIL2CacheBypassReason).toHaveBeenCalledWith('stream_request')
  })

  it('allows semantic lookup for stream requests when replay support is enabled', () => {
    config.openaiCache.l2.embeddingBaseUrl = 'https://api.siliconflow.cn/v1'
    config.openaiCache.l2.embeddingApiKey = 'silicon-key'

    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      isStream: true,
      allowStreamLookup: true,
      requestBody: {
        ...baseContext.requestBody,
        stream: true
      }
    })

    expect(plan.cacheable).toBe(true)
    expect(plan.queryText).toContain('user: hello world')
  })

  it('returns a semantic hit when the best candidate exceeds the similarity threshold', async () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan(baseContext)

    redis.getOpenAIL2Embedding.mockResolvedValue({
      vector: [1, 0]
    })
    redis.getOpenAIL2CandidateKeys.mockResolvedValue(['entry-key-1'])
    redis.getOpenAIL2Entries.mockResolvedValue([
      {
        model: 'gpt-5',
        textHash: 'candidate-hash',
        embeddingSource: plan.embeddingSource,
        requestText: 'system: You are helpful.\nuser: hello world',
        meta: {
          createdAt: new Date().toISOString()
        },
        cachedResponse: {
          statusCode: 200,
          body: { id: 'cached-response' },
          headers: {}
        }
      }
    ])
    redis.getOpenAIL2Embeddings.mockResolvedValue([
      {
        vector: [0.99, 0.01]
      }
    ])

    const result = await openaiL2SemanticCacheService.beginRequest(baseContext)

    expect(result.kind).toBe('hit')
    expect(result.similarity).toBeGreaterThan(0.95)
    expect(result.candidate).toMatchObject({
      model: 'gpt-5'
    })
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('embedding_hit')
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('cache_hit_semantic')
  })

  it('requests and caches embeddings when no embedding cache exists', async () => {
    redis.getOpenAIL2Embedding.mockResolvedValue(null)
    redis.getOpenAIL2CandidateKeys.mockResolvedValue([])
    axios.mockResolvedValue({
      status: 200,
      data: {
        data: [{ embedding: [0.12, 0.34] }]
      }
    })

    const result = await openaiL2SemanticCacheService.beginRequest(baseContext)

    expect(result.kind).toBe('miss')
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://relay.example.com/v1/embeddings',
        data: expect.objectContaining({
          model: 'text-embedding-3-small'
        })
      })
    )
    expect(redis.setOpenAIL2Embedding).toHaveBeenCalled()
  })

  it('builds a capture decision for stream responses and precomputes embeddings', async () => {
    redis.getOpenAIL2Embedding.mockResolvedValue({
      vector: [0.12, 0.34]
    })

    const result = await openaiL2SemanticCacheService.createCaptureDecision({
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
        captureOnly: true,
        queryEmbedding: [0.12, 0.34]
      })
    )
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('embedding_hit')
  })

  it('stores successful upstream responses into L2 entry and index', async () => {
    const result = await openaiL2SemanticCacheService.storeResponse(
      {
        kind: 'miss',
        tenantId: 'api-key-1',
        provider: 'openai-responses',
        endpoint: 'responses',
        model: 'gpt-5',
        textHash: 'hash-1',
        embeddingSource: 'source-hash-1',
        queryText: 'user: hello world',
        queryEmbedding: [0.1, 0.2],
        embeddingKey: 'cache:openai:l2:embed:v1:hash-1',
        embeddingModel: 'text-embedding-3-small',
        similarityThreshold: 0.95,
        entryTtlSeconds: 604800,
        embeddingTtlSeconds: 2592000,
        indexKey: 'cache:openai:l2:index:v1:api-key-1',
        maxIndexedEntries: 200
      },
      {
        statusCode: 200,
        body: {
          id: 'resp_1',
          output: [{ type: 'output_text', text: 'hello back' }]
        },
        headers: {
          'x-request-id': 'req-1',
          'content-length': '123'
        },
        actualModel: 'gpt-5'
      }
    )

    expect(result.stored).toBe(true)
    expect(redis.setOpenAIL2Embedding).toHaveBeenCalledWith(
      'cache:openai:l2:embed:v1:hash-1',
      expect.objectContaining({
        model: 'text-embedding-3-small',
        vector: [0.1, 0.2]
      }),
      2592000
    )
    expect(redis.setOpenAIL2Entry).toHaveBeenCalledWith(
      expect.stringContaining('cache:openai:l2:entry:v1:api-key-1:'),
      expect.objectContaining({
        requestText: 'user: hello world',
        responseText: 'hello back',
        cachedResponse: expect.objectContaining({
          statusCode: 200,
          headers: { 'x-request-id': 'req-1' }
        })
      }),
      604800
    )
    expect(redis.addOpenAIL2IndexEntry).toHaveBeenCalledWith(
      'cache:openai:l2:index:v1:api-key-1',
      expect.stringContaining('cache:openai:l2:entry:v1:api-key-1:'),
      expect.any(Number),
      604800,
      200
    )
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('cache_write')
  })

  it('rejects borderline semantic hits when context ranking falls below the acceptance threshold', async () => {
    const plan = openaiL2SemanticCacheService.buildCachePlan({
      ...baseContext,
      cacheContext: {
        contextFingerprint: 'current-context'
      }
    })

    redis.getOpenAIL2Embedding.mockResolvedValue({
      vector: [1, 0]
    })
    redis.getOpenAIL2CandidateKeys.mockResolvedValue(['entry-key-1'])
    redis.getOpenAIL2Entries.mockResolvedValue([
      {
        model: 'gpt-5',
        textHash: 'candidate-hash',
        embeddingSource: plan.embeddingSource,
        requestText: 'system: You are helpful.\nuser: hello world',
        contextFingerprint: 'other-context',
        meta: {
          createdAt: new Date().toISOString()
        },
        cachedResponse: {
          statusCode: 200,
          body: { id: 'semantic-hit' },
          headers: {}
        }
      }
    ])
    redis.getOpenAIL2Embeddings.mockResolvedValue([
      {
        vector: [0.95, 0.312249]
      }
    ])

    const result = await openaiL2SemanticCacheService.beginRequest({
      ...baseContext,
      cacheContext: {
        contextFingerprint: 'current-context'
      }
    })

    expect(result.kind).toBe('miss')
    expect(result.evaluation).toMatchObject({
      hasContextConflict: true
    })
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('cache_reject_ranked')
  })

  it('uses the configured embedding endpoint and key when provided', async () => {
    config.openaiCache.l2.embeddingBaseUrl = 'https://api.siliconflow.cn/v1'
    config.openaiCache.l2.embeddingApiKey = 'silicon-key'
    config.openaiCache.l2.embeddingModel = 'BAAI/bge-m3'

    redis.getOpenAIL2Embedding.mockResolvedValue(null)
    redis.getOpenAIL2CandidateKeys.mockResolvedValue([])
    axios.mockResolvedValue({
      status: 200,
      data: {
        data: [{ embedding: [0.12, 0.34] }]
      }
    })

    const result = await openaiL2SemanticCacheService.beginRequest(baseContext)

    expect(result.kind).toBe('miss')
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.siliconflow.cn/v1/embeddings',
        headers: expect.objectContaining({
          Authorization: 'Bearer silicon-key'
        }),
        data: expect.objectContaining({
          model: 'BAAI/bge-m3'
        })
      })
    )
  })
})
