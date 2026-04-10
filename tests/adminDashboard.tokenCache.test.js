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
jest.mock('../src/services/tokenCache/tokenCacheMetricsService', () => ({
  getSnapshot: jest.fn()
}))
jest.mock('../src/models/redis', () => ({
  isConnected: true,
  getGlobalStats: jest.fn(),
  getApiKeyCount: jest.fn(),
  getAllOpenAIAccounts: jest.fn(),
  getTodayStats: jest.fn(),
  getSystemAverages: jest.fn(),
  getRealtimeSystemMetrics: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))
jest.mock('../config/config', () => ({
  system: {
    timezoneOffset: 8
  }
}))

const apiKeyService = require('../src/services/apiKeyService')
const claudeAccountService = require('../src/services/account/claudeAccountService')
const claudeConsoleAccountService = require('../src/services/account/claudeConsoleAccountService')
const bedrockAccountService = require('../src/services/account/bedrockAccountService')
const ccrAccountService = require('../src/services/account/ccrAccountService')
const geminiAccountService = require('../src/services/account/geminiAccountService')
const droidAccountService = require('../src/services/account/droidAccountService')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const redis = require('../src/models/redis')
const dashboardRouter = require('../src/routes/admin/dashboard')

const tokenCacheMetricsService = require('../src/services/tokenCache/tokenCacheMetricsService')

describe('admin dashboard route', () => {
  const buildApp = () => {
    const app = express()
    app.use('/admin', dashboardRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()

    apiKeyService.getAllApiKeysFast.mockResolvedValue([])
    claudeAccountService.getAllAccounts.mockResolvedValue([])
    claudeConsoleAccountService.getAllAccounts.mockResolvedValue([])
    bedrockAccountService.getAllAccounts.mockResolvedValue({
      success: true,
      data: []
    })
    ccrAccountService.getAllAccounts.mockResolvedValue([])
    geminiAccountService.getAllAccounts.mockResolvedValue([])
    droidAccountService.getAllAccounts.mockResolvedValue([])
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([])

    redis.getGlobalStats.mockResolvedValue({
      requests: 20,
      inputTokens: 100,
      outputTokens: 50,
      allTokens: 150
    })
    redis.getApiKeyCount.mockResolvedValue({
      total: 3,
      active: 2
    })
    redis.getAllOpenAIAccounts.mockResolvedValue([])
    redis.getTodayStats.mockResolvedValue({
      apiKeysCreatedToday: 1,
      requestsToday: 4,
      tokensToday: 44,
      inputTokensToday: 30,
      outputTokensToday: 14
    })
    redis.getSystemAverages.mockResolvedValue({
      systemRPM: 7,
      systemTPM: 70
    })
    redis.getRealtimeSystemMetrics.mockResolvedValue({
      realtimeRPM: 9,
      realtimeTPM: 90,
      windowMinutes: 5
    })
    tokenCacheMetricsService.getSnapshot.mockResolvedValue({
      enabled: true
    })
  })

  it('does not include token cache stats in the dashboard response', async () => {
    const response = await request(buildApp()).get('/admin/dashboard')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.tokenCache).toBeUndefined()
    expect(tokenCacheMetricsService.getSnapshot).not.toHaveBeenCalled()
    expect(response.body.data.overview).toEqual(
      expect.objectContaining({
        totalApiKeys: 3,
        totalRequestsUsed: 20,
        totalTokensUsed: 150
      })
    )
  })
})
