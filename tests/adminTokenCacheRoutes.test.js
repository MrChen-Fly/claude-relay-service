const express = require('express')
const request = require('supertest')

const mockTokenCacheStorage = {
  getStats: jest.fn(),
  listEntries: jest.fn(),
  clearAll: jest.fn(),
  delete: jest.fn()
}

const mockHotCache = {
  clear: jest.fn(),
  cache: {
    delete: jest.fn()
  }
}

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: (req, res, next) => next()
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/services/tokenCache/tokenCacheMetricsService', () => ({
  getSnapshot: jest.fn()
}))

jest.mock('../src/services/tokenCache/tokenCacheDiagnosticsService', () => ({
  list: jest.fn()
}))

jest.mock('../src/services/tokenCache/redisTokenCacheStorage', () =>
  jest.fn(() => mockTokenCacheStorage)
)

jest.mock('../src/services/relay/openaiResponsesRelayService', () => ({
  _getTokenCacheProvider: jest.fn(() => ({
    exactCache: {
      hotCache: mockHotCache,
      delete: jest.fn(async (key) => {
        await mockTokenCacheStorage.delete(key)
      })
    }
  }))
}))

jest.mock('../config/config', () => ({
  tokenCache: {
    enabled: true,
    namespace: 'token_cache:test'
  }
}))

const tokenCacheMetricsService = require('../src/services/tokenCache/tokenCacheMetricsService')
const tokenCacheDiagnosticsService = require('../src/services/tokenCache/tokenCacheDiagnosticsService')
const tokenCacheRouter = require('../src/routes/admin/tokenCache')

describe('admin token cache routes', () => {
  const buildApp = () => {
    const app = express()
    app.use('/admin', tokenCacheRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()

    tokenCacheMetricsService.getSnapshot.mockResolvedValue({
      enabled: true,
      windowMinutes: 60,
        recent: {
          hits: 5,
          toolResultHits: 2,
          toolResultStores: 1,
          semanticChunkedRequests: 1,
          semanticChunkedChunks: 3,
          semanticSkips: 1,
          providerPromptCacheRequests: 2,
          providerPromptCacheReadRequests: 2,
          providerPromptCacheWriteRequests: 1,
          providerPromptCacheReadTokens: 3200,
          providerPromptCacheWriteTokens: 800
        },
        total: {
          hits: 10,
          toolResultHits: 4,
          toolResultStores: 2,
          semanticChunkedRequests: 2,
          semanticChunkedChunks: 5,
          semanticSkips: 2,
          providerPromptCacheRequests: 6,
          providerPromptCacheReadRequests: 5,
          providerPromptCacheWriteRequests: 3,
          providerPromptCacheReadTokens: 9600,
          providerPromptCacheWriteTokens: 2400
        },
      bypassReasons: {
        recent: [{ reason: 'temperature_nonzero', count: 2 }],
        total: [{ reason: 'temperature_nonzero', count: 3 }]
      },
      semanticSkipReasons: {
        recent: [{ reason: 'input_too_large_provider', count: 1 }],
        total: [{ reason: 'input_too_large_provider', count: 2 }]
      },
      config: {
        enabled: true,
        semanticEnabled: true,
        embedInputStrategy: 'chunked_mean',
        embedChunkMaxChunks: 8,
        embedChunkOverlapChars: 200,
        toolResultEnabled: true,
        toolResultTtlSeconds: 7200,
        toolResultAllowedToolsCount: 6
      }
    })
    mockTokenCacheStorage.getStats.mockResolvedValue({
      namespace: 'token_cache:test',
      totalKeys: 12,
      entryCount: 3,
      promptCount: 3,
      embeddingCount: 4,
      metricsKeyCount: 2
    })
    mockTokenCacheStorage.listEntries.mockResolvedValue({
      items: [
        {
          key: 'cache-key-1',
          statusCode: 200,
          createdAt: 1710000000000,
          ttlSeconds: 3600
        }
      ],
      nextCursor: '7',
      hasMore: true,
      limit: 5
    })
    mockTokenCacheStorage.clearAll.mockResolvedValue(12)
    mockTokenCacheStorage.delete.mockResolvedValue(3)
    tokenCacheDiagnosticsService.list.mockResolvedValue([
      {
        timestamp: 1710000000000,
        eventType: 'miss',
        promptCacheKey: 'session-key-1',
        sessionHash: 'session-hash-1',
        cacheStrategy: 'semantic_first',
        promptHash: 'prompt-hash-1'
      }
    ])
  })

  it('returns prompt-cache style token cache stats', async () => {
    const response = await request(buildApp()).get('/admin/token-cache/stats?windowMinutes=120')

    expect(response.status).toBe(200)
    expect(tokenCacheMetricsService.getSnapshot).toHaveBeenCalledWith(120)
    expect(response.body).toEqual({
      success: true,
      data: {
        metrics: {
          enabled: true,
          windowMinutes: 60,
            recent: {
              hits: 5,
              toolResultHits: 2,
              toolResultStores: 1,
              semanticChunkedRequests: 1,
              semanticChunkedChunks: 3,
              semanticSkips: 1,
              providerPromptCacheRequests: 2,
              providerPromptCacheReadRequests: 2,
              providerPromptCacheWriteRequests: 1,
              providerPromptCacheReadTokens: 3200,
              providerPromptCacheWriteTokens: 800
            },
            total: {
              hits: 10,
              toolResultHits: 4,
              toolResultStores: 2,
              semanticChunkedRequests: 2,
              semanticChunkedChunks: 5,
              semanticSkips: 2,
              providerPromptCacheRequests: 6,
              providerPromptCacheReadRequests: 5,
              providerPromptCacheWriteRequests: 3,
              providerPromptCacheReadTokens: 9600,
              providerPromptCacheWriteTokens: 2400
            },
          bypassReasons: {
            recent: [{ reason: 'temperature_nonzero', count: 2 }],
            total: [{ reason: 'temperature_nonzero', count: 3 }]
          },
          semanticSkipReasons: {
            recent: [{ reason: 'input_too_large_provider', count: 1 }],
            total: [{ reason: 'input_too_large_provider', count: 2 }]
          },
          config: {
            enabled: true,
            semanticEnabled: true,
            embedInputStrategy: 'chunked_mean',
            embedChunkMaxChunks: 8,
            embedChunkOverlapChars: 200,
            toolResultEnabled: true,
            toolResultTtlSeconds: 7200,
            toolResultAllowedToolsCount: 6
          }
        },
        storage: {
          namespace: 'token_cache:test',
          totalKeys: 12,
          entryCount: 3,
          promptCount: 3,
          embeddingCount: 4,
          metricsKeyCount: 2
        }
      }
    })
  })

  it('returns paginated cache entries', async () => {
    const response = await request(buildApp()).get('/admin/token-cache/entries?cursor=0&limit=5')

    expect(response.status).toBe(200)
    expect(mockTokenCacheStorage.listEntries).toHaveBeenCalledWith({
      cursor: '0',
      limit: 5
    })
    expect(response.body.data).toEqual({
      items: [
        {
          key: 'cache-key-1',
          statusCode: 200,
          createdAt: 1710000000000,
          ttlSeconds: 3600
        }
      ],
      pagination: {
        cursor: '0',
        nextCursor: '7',
        hasMore: true,
        limit: 5
      }
    })
  })

  it('returns filtered token cache diagnostics', async () => {
    const response = await request(buildApp()).get(
      '/admin/token-cache/diagnostics?limit=5&sessionHash=session-hash-1&eventType=miss'
    )

    expect(response.status).toBe(200)
    expect(tokenCacheDiagnosticsService.list).toHaveBeenCalledWith({
      limit: 5,
      promptCacheKey: '',
      sessionHash: 'session-hash-1',
      eventType: 'miss'
    })
    expect(response.body).toEqual({
      success: true,
      data: {
        items: [
          {
            timestamp: 1710000000000,
            eventType: 'miss',
            promptCacheKey: 'session-key-1',
            sessionHash: 'session-hash-1',
            cacheStrategy: 'semantic_first',
            promptHash: 'prompt-hash-1'
          }
        ],
        filters: {
          limit: 5,
          promptCacheKey: '',
          sessionHash: 'session-hash-1',
          eventType: 'miss'
        }
      }
    })
  })

  it('clears all token cache keys and hot cache', async () => {
    const response = await request(buildApp()).delete('/admin/token-cache/entries')

    expect(response.status).toBe(200)
    expect(mockTokenCacheStorage.clearAll).toHaveBeenCalled()
    expect(mockHotCache.clear).toHaveBeenCalled()
    expect(response.body).toEqual({
      success: true,
      message: 'Token cache cleared successfully',
      deletedCount: 12
    })
  })

  it('deletes one token cache entry and clears hot cache entry', async () => {
    const response = await request(buildApp()).delete('/admin/token-cache/entries/cache-key-1')

    expect(response.status).toBe(200)
    expect(mockTokenCacheStorage.delete).toHaveBeenCalledWith('cache-key-1')
    expect(mockHotCache.cache.delete).toHaveBeenCalledWith('cache-key-1')
    expect(response.body).toEqual({
      success: true,
      message: 'Token cache entry deleted successfully',
      key: 'cache-key-1'
    })
  })
})
