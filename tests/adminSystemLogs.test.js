const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const request = require('supertest')

const mockLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-relay-system-logs-'))

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
    dirname: mockLogDir
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

const systemRouter = require('../src/routes/admin/system')

describe('admin system logs route', () => {
  const buildApp = () => {
    const app = express()
    app.use('/admin', systemRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()
    fs.rmSync(mockLogDir, { recursive: true, force: true })
    fs.mkdirSync(mockLogDir, { recursive: true })

    fs.writeFileSync(
      path.join(mockLogDir, 'claude-relay-2026-04-09.log'),
      [
        JSON.stringify({
          ts: '2026-04-09 10:00:00',
          lvl: 'info',
          msg: 'service booted',
          type: 'startup'
        }),
        JSON.stringify({
          ts: '2026-04-09 10:01:00',
          lvl: 'error',
          msg: 'cache warmup failed',
          requestId: 'req-1',
          subsystem: 'cache'
        })
      ].join('\n'),
      'utf8'
    )

    fs.writeFileSync(
      path.join(mockLogDir, 'claude-relay-error-2026-04-09.log'),
      JSON.stringify({
        ts: '2026-04-09 10:02:00',
        lvl: 'error',
        msg: 'fatal upstream error'
      }),
      'utf8'
    )
  })

  afterAll(() => {
    fs.rmSync(mockLogDir, { recursive: true, force: true })
  })

  it('returns supported log files and latest entries from the default file', async () => {
    const app = buildApp()

    const response = await request(app).get('/admin/system-logs?limit=50')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.selectedFile).toBe('claude-relay-2026-04-09.log')
    expect(response.body.data.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'claude-relay-2026-04-09.log',
          kind: 'application'
        }),
        expect.objectContaining({
          name: 'claude-relay-error-2026-04-09.log',
          kind: 'error'
        })
      ])
    )
    expect(response.body.data.entries[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        message: 'cache warmup failed',
        metadata: expect.objectContaining({
          requestId: 'req-1',
          subsystem: 'cache'
        })
      })
    )
    expect(response.body.data.summary).toEqual(
      expect.objectContaining({
        sampleSize: 2,
        levelCounts: expect.objectContaining({
          error: 1,
          info: 1
        }),
        topMessages: [
          expect.objectContaining({
            level: 'error',
            message: 'cache warmup failed',
            count: 1
          })
        ],
        topTypes: [
          expect.objectContaining({
            type: 'startup',
            count: 1
          })
        ]
      })
    )
  })

  it('filters entries by file, level and keyword', async () => {
    const app = buildApp()

    const response = await request(app).get(
      '/admin/system-logs?file=claude-relay-2026-04-09.log&level=error&search=warmup'
    )

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.filteredEntries).toBe(1)
    expect(response.body.data.entries).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'cache warmup failed'
      })
    ])
  })

  it('downloads the selected system log file', async () => {
    const app = buildApp()

    const response = await request(app).get(
      '/admin/system-logs/download?file=claude-relay-2026-04-09.log'
    )

    expect(response.status).toBe(200)
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="claude-relay-2026-04-09.log"'
    )
    expect(response.text).toContain('service booted')
    expect(response.text).toContain('cache warmup failed')
  })
})
