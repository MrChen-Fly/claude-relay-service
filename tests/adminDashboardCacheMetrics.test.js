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
        }
      },
      l2: {
        enabled: true,
        shadowMode: true,
        embeddingModel: 'BAAI/bge-m3',
        similarityThreshold: 0.95,
        bypassReasons: [{ reason: 'structured_output_request', count: 2 }],
        counters: {
          cache_hit_semantic: 0,
          cache_shadow_hit: 3,
          cache_miss: 7,
          cache_bypass: 2,
          cache_write: 3,
          embedding_hit: 4,
          embedding_miss: 1
        },
        totals: {
          lookups: 10,
          requests: 12,
          embeddingRequests: 5
        },
        rates: {
          semanticHitRate: 0,
          shadowHitRate: 0.3,
          embeddingHitRate: 0.8
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
        l1: expect.objectContaining({
          bypassReasons: [{ reason: 'stream_request', count: 1 }],
          rates: expect.objectContaining({
            hitRate: 0.5
          })
        }),
        l2: expect.objectContaining({
          shadowMode: true,
          bypassReasons: [{ reason: 'structured_output_request', count: 2 }],
          rates: expect.objectContaining({
            shadowHitRate: 0.3,
            embeddingHitRate: 0.8
          })
        })
      })
    )
  })
})
