const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: (req, res, next) => next()
}))

jest.mock('../src/services/claudeCodeHeadersService', () => ({
  getAllAccountHeaders: jest.fn()
}))
jest.mock('../src/services/account/claudeAccountService', () => ({
  getAllAccounts: jest.fn()
}))
jest.mock('../src/models/redis', () => ({
  getClient: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    ttl: jest.fn()
  })),
  client: {
    get: jest.fn(),
    ttl: jest.fn(),
    del: jest.fn()
  }
}))
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))
jest.mock('../config/config', () => ({
  logging: {
    dirname: 'logs'
  },
  ldap: {
    enabled: false
  }
}))
jest.mock('../src/services/pricingService', () => ({
  pricingData: {},
  loadPricingData: jest.fn(),
  getStatus: jest.fn(() => ({})),
  forceUpdate: jest.fn()
}))
jest.mock('../src/services/systemMonitorService', () => ({
  getSnapshot: jest.fn()
}))

const systemMonitorService = require('../src/services/systemMonitorService')
const systemRouter = require('../src/routes/admin/system')

describe('admin system monitor route', () => {
  const buildApp = () => {
    const app = express()
    app.use('/admin', systemRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the current system monitor snapshot', async () => {
    systemMonitorService.getSnapshot.mockResolvedValue({
      timestamp: '2026-04-10T14:17:00.000Z',
      cpu: { available: true, usagePercent: 42.5 },
      network: { connections: { available: true, established: 18 } }
    })

    const response = await request(buildApp()).get('/admin/system-monitor')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toEqual(
      expect.objectContaining({
        cpu: expect.objectContaining({
          usagePercent: 42.5
        }),
        network: expect.objectContaining({
          connections: expect.objectContaining({
            established: 18
          })
        })
      })
    )
  })

  it('returns a 500 response when snapshot collection fails', async () => {
    systemMonitorService.getSnapshot.mockRejectedValue(new Error('monitor failed'))

    const response = await request(buildApp()).get('/admin/system-monitor')

    expect(response.status).toBe(500)
    expect(response.body.success).toBe(false)
    expect(response.body.error).toBe('Failed to get system monitor snapshot')
    expect(response.body.message).toBe('monitor failed')
  })
})
