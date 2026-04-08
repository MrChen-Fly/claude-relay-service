jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const redis = require('../src/models/redis')

describe('redis.getOpenAICacheMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('aggregates raw L1 and L2 counters into dashboard-friendly metrics', async () => {
    const hgetall = jest
      .fn()
      .mockResolvedValueOnce({
        cache_hit_exact: '12',
        cache_miss: '8',
        cache_bypass: '3',
        cache_write: '7'
      })
      .mockResolvedValueOnce({
        cache_hit_semantic: '4',
        cache_shadow_hit: '6',
        cache_miss: '10',
        cache_bypass: '2',
        cache_write: '5',
        embedding_hit: '9',
        embedding_miss: '3'
      })

    redis.getClient = jest.fn(() => ({ hgetall }))

    const metrics = await redis.getOpenAICacheMetrics()

    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l1')
    expect(hgetall).toHaveBeenCalledWith('metrics:openai:l2')
    expect(metrics).toEqual({
      l1: {
        enabled: true,
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
        shadowMode: true,
        embeddingModel: 'BAAI/bge-m3',
        similarityThreshold: 0.95,
        counters: {
          cache_hit_semantic: 4,
          cache_shadow_hit: 6,
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
          semanticHitRate: 0.2,
          shadowHitRate: 0.3,
          embeddingHitRate: 0.75
        }
      }
    })
  })

  it('returns zeroed metrics when redis is unavailable', async () => {
    redis.getClient = jest.fn(() => null)

    const metrics = await redis.getOpenAICacheMetrics()

    expect(metrics.l1.counters.cache_hit_exact).toBe(0)
    expect(metrics.l2.counters.cache_hit_semantic).toBe(0)
    expect(metrics.l2.enabled).toBe(true)
  })
})
