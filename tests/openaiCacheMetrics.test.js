jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const redis = require('../src/models/redis')
const config = require('../config/config')

describe('redis.getOpenAICacheMetrics', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    config.openaiCache = {
      ...(config.openaiCache || {}),
      enabled: true,
      l2: {
        ...(config.openaiCache?.l2 || {}),
        enabled: true,
        embeddingModel: 'BAAI/bge-m3',
        similarityThreshold: 0.95
      },
      l3: {
        ...(config.openaiCache?.l3 || {}),
        enabled: true
      }
    }

    const resetBaselineHgetall = jest.fn().mockResolvedValue({})
    redis.getClient = jest.fn(() => ({ hgetall: resetBaselineHgetall }))
    await redis.initializeOpenAICacheMetricsBaseline()
  })

  it('aggregates raw counters and exposes cumulative plus since-process-start views', async () => {
    const hgetall = jest
      .fn()
      .mockResolvedValueOnce({
        cache_hit_exact: '2',
        cache_miss: '1',
        cache_bypass: '1',
        cache_write: '1',
        'bypass_reason:stream_request': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_semantic: '4',
        cache_miss: '4',
        cache_bypass: '1',
        cache_write: '1',
        cache_store_skip: '1',
        embedding_hit: '2',
        embedding_miss: '1',
        'bypass_reason:stream_request': '1',
        'store_skip_reason:response_has_tool_calls': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_exact: '1',
        cache_miss: '1',
        cache_bypass: '1',
        cache_write: '0',
        'bypass_reason:temperature_too_high': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_exact: '12',
        cache_miss: '8',
        cache_bypass: '3',
        cache_write: '7',
        'bypass_reason:stream_request': '2',
        'bypass_reason:dynamic_tools': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_semantic: '10',
        cache_miss: '10',
        cache_bypass: '2',
        cache_write: '5',
        cache_store_skip: '3',
        embedding_hit: '9',
        embedding_miss: '3',
        'bypass_reason:stream_request': '1',
        'bypass_reason:structured_output_request': '1',
        'store_skip_reason:response_has_tool_calls': '2',
        'store_skip_reason:invalid_response_payload': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_exact: '4',
        cache_miss: '6',
        cache_bypass: '2',
        cache_write: '3',
        'bypass_reason:temperature_too_high': '2'
      })

    redis.getClient = jest.fn(() => ({ hgetall }))

    await redis.initializeOpenAICacheMetricsBaseline()
    const metrics = await redis.getOpenAICacheMetrics()

    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l1')
    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l2')
    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l3')
    expect(metrics.scope).toEqual(
      expect.objectContaining({
        primary: 'sinceProcessStart',
        primaryLabel: '本次进程',
        baselineAvailable: true
      })
    )

    expect(metrics.l1.counters).toEqual({
      cache_hit_exact: 12,
      cache_miss: 8,
      cache_bypass: 3,
      cache_write: 7
    })
    expect(metrics.l1.summary).toEqual({
      cacheableRequests: 20,
      bypassedRequests: 3,
      participationRate: 0.8696,
      bypassRate: 0.1304,
      topBypassReason: { reason: 'stream_request', count: 2 },
      status: 'enabled'
    })
    expect(metrics.l1.sinceProcessStart.counters).toEqual({
      cache_hit_exact: 10,
      cache_miss: 7,
      cache_bypass: 2,
      cache_write: 6
    })
    expect(metrics.l1.sinceProcessStart.bypassReasons).toEqual([
      { reason: 'dynamic_tools', count: 1 },
      { reason: 'stream_request', count: 1 }
    ])
    expect(metrics.l1.sinceProcessStart.summary).toEqual({
      cacheableRequests: 17,
      bypassedRequests: 2,
      participationRate: 0.8947,
      bypassRate: 0.1053,
      topBypassReason: { reason: 'dynamic_tools', count: 1 },
      status: 'enabled'
    })

    expect(metrics.l2.counters).toEqual({
      cache_hit_semantic: 10,
      cache_miss: 10,
      cache_bypass: 2,
      cache_write: 5,
      cache_store_skip: 3,
      cache_reject_ranked: 0,
      embedding_hit: 9,
      embedding_miss: 3,
      followup_enriched: 0,
      recall_lookup: 0,
      recall_shard_hit: 0,
      recall_shard_miss: 0
    })
    expect(metrics.l2.rates).toEqual({
      semanticHitRate: 0.5,
      embeddingHitRate: 0.75,
      rankedRejectRate: 0,
      followUpEnrichmentRate: 0,
      recallShardHitRate: 0
    })
    expect(metrics.l2.storeSkipReasons).toEqual([
      { reason: 'response_has_tool_calls', count: 2 },
      { reason: 'invalid_response_payload', count: 1 }
    ])
    expect(metrics.l2.sinceProcessStart.counters).toEqual({
      cache_hit_semantic: 6,
      cache_miss: 6,
      cache_bypass: 1,
      cache_write: 4,
      cache_store_skip: 2,
      cache_reject_ranked: 0,
      embedding_hit: 7,
      embedding_miss: 2,
      followup_enriched: 0,
      recall_lookup: 0,
      recall_shard_hit: 0,
      recall_shard_miss: 0
    })
    expect(metrics.l2.sinceProcessStart.summary).toEqual({
      cacheableRequests: 12,
      bypassedRequests: 1,
      participationRate: 0.9231,
      bypassRate: 0.0769,
      topBypassReason: { reason: 'structured_output_request', count: 1 },
      status: 'enabled'
    })
    expect(metrics.l2.sinceProcessStart.storeSkipReasons).toEqual([
      { reason: 'invalid_response_payload', count: 1 },
      { reason: 'response_has_tool_calls', count: 1 }
    ])

    expect(metrics.l3.counters).toEqual({
      cache_hit_exact: 4,
      cache_miss: 6,
      cache_bypass: 2,
      cache_write: 3
    })
    expect(metrics.l3.sinceProcessStart.counters).toEqual({
      cache_hit_exact: 3,
      cache_miss: 5,
      cache_bypass: 1,
      cache_write: 3
    })
    expect(metrics.l3.sinceProcessStart.summary).toEqual({
      cacheableRequests: 8,
      bypassedRequests: 1,
      participationRate: 0.8889,
      bypassRate: 0.1111,
      topBypassReason: { reason: 'temperature_too_high', count: 1 },
      status: 'enabled'
    })
  })

  it('returns zeroed metrics when redis is unavailable', async () => {
    redis.getClient = jest.fn(() => null)

    const metrics = await redis.getOpenAICacheMetrics()

    expect(metrics.l1.counters.cache_hit_exact).toBe(0)
    expect(metrics.l1.bypassReasons).toEqual([])
    expect(metrics.l1.sinceProcessStart.counters.cache_hit_exact).toBe(0)
    expect(metrics.l2.counters.cache_hit_semantic).toBe(0)
    expect(metrics.l2.bypassReasons).toEqual([])
    expect(metrics.l2.sinceProcessStart.counters.cache_hit_semantic).toBe(0)
    expect(metrics.l3.counters.cache_hit_exact).toBe(0)
    expect(metrics.l3.bypassReasons).toEqual([])
    expect(metrics.l3.sinceProcessStart.counters.cache_hit_exact).toBe(0)
    expect(metrics.l2.enabled).toBe(true)
    expect(metrics.l3.enabled).toBe(true)
  })
})
