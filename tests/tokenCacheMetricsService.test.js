const { TokenCacheMetricsService } = require('../src/services/tokenCache/tokenCacheMetricsService')

describe('tokenCacheMetricsService', () => {
  it('records totals and minute buckets in Redis', async () => {
    const pipeline = {
      hincrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    }
    const service = new TokenCacheMetricsService({
      redis: {
        isConnected: true,
        getClient: jest.fn(() => ({
          pipeline: jest.fn(() => pipeline)
        }))
      },
      config: {
        enabled: true,
        namespace: 'token_cache:test'
      }
    })

    await service.record({
      requests: 1,
      bypasses: 1,
      'bypassReason:dynamic_tools': 1
    })

    expect(pipeline.hincrby).toHaveBeenCalledWith('token_cache:test:metrics:total', 'requests', 1)
    expect(pipeline.hincrby).toHaveBeenCalledWith('token_cache:test:metrics:total', 'bypasses', 1)
    expect(pipeline.hincrby).toHaveBeenCalledWith(
      'token_cache:test:metrics:total',
      'bypassReason:dynamic_tools',
      1
    )
    expect(pipeline.expire).toHaveBeenCalled()
    expect(pipeline.exec).toHaveBeenCalled()
  })

  it('builds recent and total summaries from Redis buckets', async () => {
    const pipeline = {
      hgetall: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          {
            requests: '4',
            eligibleRequests: '3',
            hits: '2',
            bypasses: '1',
            exactHits: '1',
            toolResultHits: '1',
            toolResultStores: '1',
            semanticHits: '1',
            semanticChunkedRequests: '1',
            semanticChunkedChunks: '3',
            semanticSkips: '1',
            providerCalls: '2',
            providerErrors: '1',
            'bypassReason:dynamic_tools': '1',
            'semanticSkipReason:input_too_large_provider': '1'
          }
        ],
        [
          null,
          {
            requests: '1',
            eligibleRequests: '1',
            misses: '1',
            stores: '1'
          }
        ]
      ])
    }
    const service = new TokenCacheMetricsService({
      redis: {
        isConnected: true,
        getClient: jest.fn(() => ({
          hgetall: jest.fn().mockResolvedValue({
            requests: '10',
            eligibleRequests: '8',
            hits: '5',
            misses: '3',
            bypasses: '2',
            exactHits: '3',
            toolResultHits: '1',
            toolResultStores: '2',
            semanticHits: '2',
            semanticChunkedRequests: '2',
            semanticChunkedChunks: '5',
            semanticSkips: '1',
            semanticVerifiedHits: '1',
            providerCalls: '6',
            providerErrors: '1',
            'bypassReason:dynamic_tools': '2',
            'semanticSkipReason:input_too_large_provider': '1'
          }),
          pipeline: jest.fn(() => pipeline)
        }))
      },
      config: {
        enabled: true,
        semanticEnabled: true,
        namespace: 'token_cache:test',
        ttlSeconds: 3600,
        maxEntries: 1000,
        lowThreshold: 0.3,
        highThreshold: 0.7,
        enableGrayZoneVerifier: true,
        useANNIndex: true,
        openaiBaseUrl: 'https://api.siliconflow.cn/v1',
        openaiEmbedModel: 'BAAI/bge-m3',
        openaiEmbedInputStrategy: 'chunked_mean',
        openaiEmbedChunkMaxChunks: 8,
        openaiEmbedChunkOverlapChars: 64,
        openaiVerifyModel: 'Qwen/Qwen2.5-7B-Instruct'
      }
    })

    const snapshot = await service.getSnapshot(2)

    expect(snapshot).toEqual(
      expect.objectContaining({
        enabled: true,
        windowMinutes: 2,
        config: expect.objectContaining({
          semanticEnabled: true,
          toolResultEnabled: false,
          useANNIndex: true,
          baseUrl: 'https://api.siliconflow.cn/v1',
          embedInputStrategy: 'chunked_mean',
          embedChunkMaxChunks: 8,
          embedChunkOverlapChars: 64
        })
      })
    )
    expect(snapshot.recent).toEqual(
      expect.objectContaining({
        requests: 5,
        eligibleRequests: 4,
        hits: 2,
        misses: 1,
        bypasses: 1,
        stores: 1,
        toolResultHits: 1,
        toolResultStores: 1,
        semanticChunkedRequests: 1,
        semanticChunkedChunks: 3,
        semanticSkips: 1,
        hitRate: 0.5,
        eligibleRate: 0.8,
        providerErrorRate: 0.5
      })
    )
    expect(snapshot.total).toEqual(
      expect.objectContaining({
        requests: 10,
        eligibleRequests: 8,
        hits: 5,
        toolResultStores: 2,
        semanticChunkedRequests: 2,
        semanticChunkedChunks: 5,
        semanticSkips: 1,
        semanticVerifiedHits: 1
      })
    )
    expect(snapshot.bypassReasons.recent).toEqual([
      {
        reason: 'dynamic_tools',
        count: 1
      }
    ])
    expect(snapshot.semanticSkipReasons.recent).toEqual([
      {
        reason: 'input_too_large_provider',
        count: 1
      }
    ])
  })
})
