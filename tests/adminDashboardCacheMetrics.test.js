const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: (req, res, next) => next()
}))

jest.mock('../src/services/apiKeyService', () => ({
  getAllApiKeysFast: jest.fn()
}))
jest.mock('../src/services/account/claudeAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/claudeConsoleAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/bedrockAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/ccrAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/geminiAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/droidAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/models/redis', () => ({
  isConnected: true,
  getGlobalStats: jest.fn(),
  getApiKeyCount: jest.fn(),
  getAllOpenAIAccounts: jest.fn(),
  getTodayStats: jest.fn(),
  getSystemAverages: jest.fn(),
  getRealtimeSystemMetrics: jest.fn(),
  getOpenAICacheMetrics: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))
jest.mock('../src/utils/costCalculator', () => ({
  calculateCost: jest.fn(() => ({
    costs: { total: 0 },
    formatted: { total: '$0.00' },
    pricing: {}
  }))
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  getAllTempUnavailable: jest.fn()
}))

const redis = require('../src/models/redis')
const claudeAccountService = require('../src/services/account/claudeAccountService')
const claudeConsoleAccountService = require('../src/services/account/claudeConsoleAccountService')
const bedrockAccountService = require('../src/services/account/bedrockAccountService')
const ccrAccountService = require('../src/services/account/ccrAccountService')
const geminiAccountService = require('../src/services/account/geminiAccountService')
const droidAccountService = require('../src/services/account/droidAccountService')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const dashboardRouter = require('../src/routes/admin/dashboard')

describe('admin dashboard cache metrics', () => {
  const buildApp = () => {
    const app = express()
    app.use('/admin', dashboardRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()

    redis.getGlobalStats.mockResolvedValue({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      allTokens: 0
    })
    redis.getApiKeyCount.mockResolvedValue({ total: 2, active: 1 })
    redis.getAllOpenAIAccounts.mockResolvedValue([])
    redis.getTodayStats.mockResolvedValue({
      apiKeysCreatedToday: 0,
      requestsToday: 0,
      tokensToday: 0,
      inputTokensToday: 0,
      outputTokensToday: 0,
      cacheCreateTokensToday: 0,
      cacheReadTokensToday: 0
    })
    redis.getSystemAverages.mockResolvedValue({
      systemRPM: 0,
      systemTPM: 0
    })
    redis.getRealtimeSystemMetrics.mockResolvedValue({
      realtimeRPM: 0,
      realtimeTPM: 0,
      windowMinutes: 5
    })
    redis.getOpenAICacheMetrics.mockResolvedValue({
      scope: {
        primary: 'sinceProcessStart',
        primaryLabel: '本次进程',
        baselineAvailable: true,
        processStartedAt: '2026-04-09T04:00:00.000Z',
        baselineCapturedAt: '2026-04-09T04:00:01.000Z',
        note: '默认按本次进程观察，累计历史只保留作长期参考。'
      },
      l1: {
        enabled: true,
        bypassReasons: [{ reason: 'stream_request', count: 1 }],
        counters: {
          cache_hit_exact: 5,
          cache_miss: 5,
          cache_bypass: 1,
          cache_write: 2
        },
        totals: {
          lookups: 10,
          requests: 11
        },
        rates: {
          hitRate: 0.5
        },
        cumulative: {
          enabled: true,
          bypassReasons: [{ reason: 'stream_request', count: 1 }],
          counters: {
            cache_hit_exact: 5,
            cache_miss: 5,
            cache_bypass: 1,
            cache_write: 2
          },
          totals: {
            lookups: 10,
            requests: 11
          },
          rates: {
            hitRate: 0.5
          }
        },
        sinceProcessStart: {
          enabled: true,
          bypassReasons: [{ reason: 'stream_request', count: 1 }],
          counters: {
            cache_hit_exact: 2,
            cache_miss: 3,
            cache_bypass: 1,
            cache_write: 1
          },
          totals: {
            lookups: 5,
            requests: 6
          },
          rates: {
            hitRate: 0.4
          }
        }
      },
      l2: {
        enabled: true,
        embeddingModel: 'BAAI/bge-m3',
        similarityThreshold: 0.95,
        bypassReasons: [{ reason: 'structured_output_request', count: 2 }],
        counters: {
          cache_hit_semantic: 3,
          cache_miss: 7,
          cache_bypass: 2,
          cache_write: 3,
          cache_reject_ranked: 2,
          embedding_hit: 4,
          embedding_miss: 1,
          followup_enriched: 2,
          recall_lookup: 3,
          recall_shard_hit: 1,
          recall_shard_miss: 2
        },
        totals: {
          lookups: 10,
          requests: 12,
          embeddingRequests: 5
        },
        rates: {
          semanticHitRate: 0.3,
          embeddingHitRate: 0.8,
          rankedRejectRate: 0.2,
          followUpEnrichmentRate: 0.2,
          recallShardHitRate: 0.3333
        },
        configSnapshot: {
          embeddingModel: 'BAAI/bge-m3',
          similarityThreshold: 0.95,
          rankAcceptanceThreshold: 0.9,
          recallTokenLimit: 6,
          recallPerTokenLimit: 12,
          recallRecentLimit: 20,
          recallTotalLimit: 60,
          maxCandidates: 20,
          maxIndexedEntries: 200,
          entryTtlSeconds: 604800,
          embeddingTtlSeconds: 2592000,
          contextBufferEnabled: true,
          contextBufferMaxItems: 6,
          contextBufferTtlSeconds: 604800
        },
        diagnostics: {
          sampleSize: 10,
          tuningReadiness: 'low',
          primaryIssue: 'threshold',
          message: '候选已经能召回，但较多结果卡在相似度或 rerank 接受线。',
          rankedRejectRate: 0.2,
          followUpEnrichmentRate: 0.2,
          recallShardHitRate: 0.3333,
          recallShardMissRate: 0.6667
        },
        recommendations: [
          {
            id: 'relax_similarity_threshold',
            priority: 'high',
            title: '适度放宽 L2 接受线',
            summary: '召回后被 rerank 拒绝的比例偏高。',
            params: [
              'OPENAI_L2_CACHE_SIMILARITY_THRESHOLD',
              'OPENAI_L2_CACHE_RANK_ACCEPTANCE_THRESHOLD'
            ],
            currentValue: '0.95 / 0.90',
            suggestedValue: '0.93 / 0.87',
            rationale: '先做小步放宽。'
          }
        ],
        cumulative: {
          enabled: true,
          embeddingModel: 'BAAI/bge-m3',
          similarityThreshold: 0.95,
          bypassReasons: [{ reason: 'structured_output_request', count: 2 }],
          counters: {
            cache_hit_semantic: 3,
            cache_miss: 7,
            cache_bypass: 2,
            cache_write: 3,
            cache_reject_ranked: 2,
            embedding_hit: 4,
            embedding_miss: 1,
            followup_enriched: 2,
            recall_lookup: 3,
            recall_shard_hit: 1,
            recall_shard_miss: 2
          },
          totals: {
            lookups: 10,
            requests: 12,
            embeddingRequests: 5
          },
          rates: {
            semanticHitRate: 0.3,
            embeddingHitRate: 0.8,
            rankedRejectRate: 0.2,
            followUpEnrichmentRate: 0.2,
            recallShardHitRate: 0.3333
          }
        },
        sinceProcessStart: {
          enabled: true,
          embeddingModel: 'BAAI/bge-m3',
          similarityThreshold: 0.95,
          bypassReasons: [{ reason: 'structured_output_request', count: 1 }],
          counters: {
            cache_hit_semantic: 2,
            cache_miss: 4,
            cache_bypass: 1,
            cache_write: 2,
            cache_reject_ranked: 1,
            embedding_hit: 3,
            embedding_miss: 1,
            followup_enriched: 1,
            recall_lookup: 2,
            recall_shard_hit: 1,
            recall_shard_miss: 1
          },
          totals: {
            lookups: 6,
            requests: 7,
            embeddingRequests: 4
          },
          rates: {
            semanticHitRate: 0.3333,
            embeddingHitRate: 0.75,
            rankedRejectRate: 0.1667,
            followUpEnrichmentRate: 0.1667,
            recallShardHitRate: 0.5
          }
        }
      },
      l3: {
        enabled: true,
        bypassReasons: [{ reason: 'temperature_too_high', count: 1 }],
        counters: {
          cache_hit_exact: 2,
          cache_miss: 8,
          cache_bypass: 1,
          cache_write: 2
        },
        totals: {
          lookups: 10,
          requests: 11
        },
        rates: {
          hitRate: 0.2
        },
        cumulative: {
          enabled: true,
          bypassReasons: [{ reason: 'temperature_too_high', count: 1 }],
          counters: {
            cache_hit_exact: 2,
            cache_miss: 8,
            cache_bypass: 1,
            cache_write: 2
          },
          totals: {
            lookups: 10,
            requests: 11
          },
          rates: {
            hitRate: 0.2
          }
        },
        sinceProcessStart: {
          enabled: true,
          bypassReasons: [{ reason: 'temperature_too_high', count: 1 }],
          counters: {
            cache_hit_exact: 1,
            cache_miss: 3,
            cache_bypass: 1,
            cache_write: 1
          },
          totals: {
            lookups: 4,
            requests: 5
          },
          rates: {
            hitRate: 0.25
          }
        }
      }
    })

    claudeAccountService.getAllAccounts.mockResolvedValue([])
    claudeConsoleAccountService.getAllAccounts.mockResolvedValue([])
    geminiAccountService.getAllAccounts.mockResolvedValue([])
    bedrockAccountService.getAllAccounts.mockResolvedValue({ success: true, data: [] })
    ccrAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])
    droidAccountService.getAllAccounts.mockResolvedValue([])
  })

  it('includes cacheMetrics in dashboard payload', async () => {
    const app = buildApp()

    const response = await request(app).get('/admin/dashboard')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.cacheMetrics).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          primary: 'sinceProcessStart',
          baselineAvailable: true
        }),
        l1: expect.objectContaining({
          bypassReasons: [{ reason: 'stream_request', count: 1 }],
          rates: expect.objectContaining({
            hitRate: 0.5
          }),
          sinceProcessStart: expect.objectContaining({
            counters: expect.objectContaining({
              cache_hit_exact: 2
            })
          })
        }),
        l2: expect.objectContaining({
          bypassReasons: [{ reason: 'structured_output_request', count: 2 }],
          rates: expect.objectContaining({
            semanticHitRate: 0.3,
            embeddingHitRate: 0.8,
            rankedRejectRate: 0.2
          }),
          diagnostics: expect.objectContaining({
            primaryIssue: 'threshold'
          }),
          recommendations: [
            expect.objectContaining({
              id: 'relax_similarity_threshold'
            })
          ],
          sinceProcessStart: expect.objectContaining({
            counters: expect.objectContaining({
              cache_hit_semantic: 2
            })
          })
        }),
        l3: expect.objectContaining({
          bypassReasons: [{ reason: 'temperature_too_high', count: 1 }],
          rates: expect.objectContaining({
            hitRate: 0.2
          })
        })
      })
    )
  })
})
