jest.mock('../src/services/cache/openaiL1CacheService', () => ({
  beginRequest: jest.fn(),
  createCaptureDecision: jest.fn(),
  storeResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn()
}))
jest.mock('../src/services/cache/openaiL2SemanticCacheService', () => ({
  beginRequest: jest.fn(),
  createCaptureDecision: jest.fn(),
  storeResponse: jest.fn(),
  extractSemanticText: jest.fn(),
  extractResponseText: jest.fn()
}))
jest.mock('../src/services/cache/openaiL3GlobalCacheService', () => ({
  beginRequest: jest.fn(),
  createCaptureDecision: jest.fn(),
  storeResponse: jest.fn(),
  finalizeRequest: jest.fn()
}))
jest.mock('../src/services/cache/gptcache/contextBufferService', () => ({
  getSnapshot: jest.fn(),
  rememberInteraction: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const openaiL1CacheService = require('../src/services/cache/openaiL1CacheService')
const openaiL2SemanticCacheService = require('../src/services/cache/openaiL2SemanticCacheService')
const openaiL3GlobalCacheService = require('../src/services/cache/openaiL3GlobalCacheService')
const contextBufferService = require('../src/services/cache/gptcache/contextBufferService')
const openaiCacheChainService = require('../src/services/cache/gptcache/openaiCacheChainService')

describe('openaiCacheChainService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiL2SemanticCacheService.extractSemanticText.mockReturnValue({
      supported: true,
      text: 'user: hello world'
    })
    openaiL2SemanticCacheService.extractResponseText.mockReturnValue('hello back')
    contextBufferService.getSnapshot.mockResolvedValue({
      enabled: true,
      bufferKey: 'buffer-key-1',
      ttlSeconds: 604800,
      maxItems: 6,
      items: []
    })
  })

  it('backfills L1 when L2 returns a cache hit', async () => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'l1-key-1'
    })
    openaiL2SemanticCacheService.beginRequest.mockResolvedValue({
      kind: 'hit',
      entry: {
        statusCode: 200,
        body: { id: 'cached' }
      }
    })

    const result = await openaiCacheChainService.beginRequest({
      tenantId: 'api-key-1',
      provider: 'openai-responses',
      endpoint: 'responses',
      requestBody: {
        input: 'hello'
      },
      requestHeaders: {
        session_id: 'session-1'
      },
      fullAccount: {
        baseApi: 'https://relay.example.com',
        apiKey: 'secret'
      }
    })

    expect(result.kind).toBe('hit')
    expect(result.source).toBe('l2')
    expect(openaiL1CacheService.storeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'miss',
        cacheKey: 'l1-key-1'
      }),
      expect.objectContaining({
        statusCode: 200,
        body: { id: 'cached' }
      })
    )
    expect(openaiL2SemanticCacheService.beginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheContext: expect.objectContaining({
          scopeType: 'session',
          hasScope: true,
          contextFingerprint: expect.any(String)
        })
      })
    )
    expect(openaiL3GlobalCacheService.beginRequest).not.toHaveBeenCalled()
  })

  it('backfills L1 and L2 when L3 returns a global cache hit', async () => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'l1-key-1'
    })
    openaiL2SemanticCacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      tenantId: 'api-key-1',
      queryEmbedding: [0.1, 0.2]
    })
    openaiL3GlobalCacheService.beginRequest.mockResolvedValue({
      kind: 'hit',
      entry: {
        statusCode: 200,
        body: { id: 'global-cached' }
      }
    })

    const result = await openaiCacheChainService.beginRequest({
      tenantId: 'api-key-1',
      provider: 'openai-responses',
      endpoint: 'responses',
      requestBody: {
        input: 'hello'
      },
      requestHeaders: {},
      fullAccount: {
        baseApi: 'https://relay.example.com',
        apiKey: 'secret'
      }
    })

    expect(result.kind).toBe('hit')
    expect(result.source).toBe('l3')
    expect(openaiL1CacheService.storeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'miss',
        cacheKey: 'l1-key-1'
      }),
      expect.objectContaining({
        statusCode: 200,
        body: { id: 'global-cached' }
      })
    )
    expect(openaiL2SemanticCacheService.storeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'miss',
        tenantId: 'api-key-1'
      }),
      expect.objectContaining({
        statusCode: 200,
        body: { id: 'global-cached' }
      })
    )
  })

  it('stores upstream responses across L1, L2, L3, and context buffer', async () => {
    const result = await openaiCacheChainService.storeUpstreamResponse(
      {
        l1Decision: {
          kind: 'miss',
          cacheKey: 'l1-key-1'
        },
        l2Decision: {
          kind: 'miss',
          tenantId: 'api-key-1'
        },
        l3Decision: {
          kind: 'miss',
          cacheKey: 'l3-key-1'
        },
        semanticRequestText: 'user: hello world',
        bufferSnapshot: {
          enabled: true,
          bufferKey: 'buffer-key-1',
          ttlSeconds: 604800,
          maxItems: 6
        }
      },
      {
        statusCode: 200,
        body: {
          output: [{ type: 'output_text', text: 'hello back' }]
        },
        actualModel: 'gpt-5'
      }
    )

    expect(result.stored).toBe(true)
    expect(openaiL1CacheService.storeResponse).toHaveBeenCalled()
    expect(openaiL2SemanticCacheService.storeResponse).toHaveBeenCalled()
    expect(openaiL3GlobalCacheService.storeResponse).toHaveBeenCalled()
    expect(contextBufferService.rememberInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        bufferKey: 'buffer-key-1'
      }),
      expect.objectContaining({
        requestText: 'user: hello world',
        responseText: 'hello back',
        model: 'gpt-5',
        cacheSource: 'upstream'
      })
    )
  })

  it('prepares capture decisions for stream requests that were bypassed during lookup', async () => {
    openaiL1CacheService.createCaptureDecision.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'stream-l1-key'
    })
    openaiL2SemanticCacheService.createCaptureDecision.mockResolvedValue({
      kind: 'miss',
      tenantId: 'api-key-1',
      queryEmbedding: [0.1, 0.2]
    })
    openaiL3GlobalCacheService.createCaptureDecision.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'stream-l3-key'
    })

    const result = await openaiCacheChainService.prepareStreamWriteback(
      {
        kind: 'bypass',
        source: 'upstream',
        l1Decision: {
          kind: 'bypass',
          reason: 'stream_request'
        },
        l2Decision: {
          kind: 'bypass',
          reason: 'stream_request'
        },
        l3Decision: {
          kind: 'bypass',
          reason: 'stream_request'
        },
        cacheContext: {
          contextFingerprint: 'ctx-1'
        }
      },
      {
        tenantId: 'api-key-1',
        endpoint: 'responses',
        requestBody: {
          input: 'hello',
          stream: true
        }
      }
    )

    expect(openaiL1CacheService.createCaptureDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'api-key-1',
        endpoint: 'responses'
      })
    )
    expect(openaiL2SemanticCacheService.createCaptureDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'api-key-1',
        endpoint: 'responses',
        cacheContext: expect.objectContaining({
          contextFingerprint: 'ctx-1'
        })
      })
    )
    expect(openaiL3GlobalCacheService.createCaptureDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'api-key-1',
        endpoint: 'responses'
      })
    )
    expect(result.l1Decision).toEqual(
      expect.objectContaining({
        kind: 'miss',
        cacheKey: 'stream-l1-key'
      })
    )
    expect(result.l2Decision).toEqual(
      expect.objectContaining({
        kind: 'miss',
        tenantId: 'api-key-1'
      })
    )
    expect(result.l3Decision).toEqual(
      expect.objectContaining({
        kind: 'miss',
        cacheKey: 'stream-l3-key'
      })
    )
  })

  it('enables stream lookup on the cache services when replay is supported upstream', async () => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'l1-stream-key'
    })
    openaiL2SemanticCacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      tenantId: 'api-key-1'
    })
    openaiL3GlobalCacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'l3-stream-key'
    })

    await openaiCacheChainService.beginRequest({
      tenantId: 'api-key-1',
      provider: 'openai-responses',
      endpoint: 'responses',
      isStream: true,
      requestBody: {
        input: 'hello',
        stream: true
      },
      requestHeaders: {},
      fullAccount: {
        baseApi: 'https://relay.example.com',
        apiKey: 'secret'
      }
    })

    expect(openaiL1CacheService.beginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        isStream: true,
        allowStreamLookup: true
      })
    )
    expect(openaiL2SemanticCacheService.beginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        isStream: true,
        allowStreamLookup: true
      })
    )
    expect(openaiL3GlobalCacheService.beginRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        isStream: true,
        allowStreamLookup: true
      })
    )
  })
})
