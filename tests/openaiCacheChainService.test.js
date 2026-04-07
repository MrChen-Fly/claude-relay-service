jest.mock('../src/services/cache/openaiL1CacheService', () => ({
  beginRequest: jest.fn(),
  storeResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn()
}))
jest.mock('../src/services/cache/openaiL2SemanticCacheService', () => ({
  beginRequest: jest.fn(),
  storeResponse: jest.fn(),
  extractSemanticText: jest.fn(),
  extractResponseText: jest.fn()
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
  })

  it('stores upstream responses across L1, L2, and context buffer', async () => {
    const result = await openaiCacheChainService.storeUpstreamResponse(
      {
        l1Decision: {
          kind: 'miss',
          cacheKey: 'l1-key-1'
        },
        l2Decision: {
          kind: 'shadow_hit',
          tenantId: 'api-key-1'
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
})
