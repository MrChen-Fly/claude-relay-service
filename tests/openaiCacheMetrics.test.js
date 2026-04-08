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
  beforeEach(() => {
    jest.clearAllMocks()
    config.openaiCache = {
      ...(config.openaiCache || {}),
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
  })

  it('aggregates raw L1, L2, and L3 counters into dashboard-friendly metrics', async () => {
    const hgetall = jest
      .fn()
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
        embedding_hit: '9',
        embedding_miss: '3',
        'bypass_reason:stream_request': '1',
        'bypass_reason:structured_output_request': '1'
      })
      .mockResolvedValueOnce({
        cache_hit_exact: '4',
        cache_miss: '6',
        cache_bypass: '2',
        cache_write: '3',
        'bypass_reason:temperature_too_high': '2'
      })

    redis.getClient = jest.fn(() => ({ hgetall }))

    const metrics = await redis.getOpenAICacheMetrics()

    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l1')
    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l2')
    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l3')
    expect(metrics).toEqual({
      l1: {
        enabled: true,
        bypassReasons: [
          { reason: 'stream_request', count: 2 },
          { reason: 'dynamic_tools', count: 1 }
        ],
        counters: {
          cache_hit_exact: 12,
          cache_miss: 8,
          cache_bypass: 3,
          cache_write: 7
        },
        totals: {
          lookups: 20,
          requests: 23
        },
        rates: {
          hitRate: 0.6
        }
      },
      l2: {
        enabled: true,
        embeddingModel: 'BAAI/bge-m3',
        similarityThreshold: 0.95,
        bypassReasons: [
          { reason: 'stream_request', count: 1 },
          { reason: 'structured_output_request', count: 1 }
        ],
        counters: {
          cache_hit_semantic: 10,
          cache_miss: 10,
          cache_bypass: 2,
          cache_write: 5,
          embedding_hit: 9,
          embedding_miss: 3
        },
        totals: {
          lookups: 20,
          requests: 22,
          embeddingRequests: 12
        },
        rates: {
          semanticHitRate: 0.5,
          embeddingHitRate: 0.75
        }
      },
      l3: {
        enabled: true,
        bypassReasons: [{ reason: 'temperature_too_high', count: 2 }],
        counters: {
          cache_hit_exact: 4,
          cache_miss: 6,
          cache_bypass: 2,
          cache_write: 3
        },
        totals: {
          lookups: 10,
          requests: 12
        },
        rates: {
          hitRate: 0.4
        }
      }
    })
  })

  it('returns zeroed metrics when redis is unavailable', async () => {
    redis.getClient = jest.fn(() => null)

    const metrics = await redis.getOpenAICacheMetrics()

    expect(metrics.l1.counters.cache_hit_exact).toBe(0)
    expect(metrics.l1.bypassReasons).toEqual([])
    expect(metrics.l2.counters.cache_hit_semantic).toBe(0)
    expect(metrics.l2.bypassReasons).toEqual([])
    expect(metrics.l3.counters.cache_hit_exact).toBe(0)
    expect(metrics.l3.bypassReasons).toEqual([])
    expect(metrics.l2.enabled).toBe(true)
    expect(metrics.l3.enabled).toBe(true)
  })
})
