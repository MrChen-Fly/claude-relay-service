const express = require('express')
const request = require('supertest')

jest.mock('../src/middleware/auth', () => ({
  authenticateAdmin: (req, res, next) => next()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAllAccounts: jest.fn(),
  createAccount: jest.fn(),
  getAccount: jest.fn(),
  updateAccount: jest.fn()
}))

jest.mock('../src/services/accountGroupService', () => ({
  getGroup: jest.fn(),
  getGroupMembers: jest.fn(),
  setAccountGroups: jest.fn(),
  addAccountToGroup: jest.fn(),
  getAccountGroups: jest.fn(),
  removeAccountFromGroup: jest.fn(),
  removeAccountFromAllGroups: jest.fn()
}))

jest.mock('../src/services/apiKeyService', () => ({
  getAllApiKeysLite: jest.fn(),
  unbindAccountFromAllKeys: jest.fn()
}))
jest.mock('../src/services/openaiProtocol/openaiResponsesUpstreamProbeService', () => ({
  probeAccount: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn(),
  batchGetAccountDailyCost: jest.fn(),
  getDateStringInTimezone: jest.fn(),
  getDateInTimezone: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

jest.mock('../src/utils/webhookNotifier', () => ({}))
jest.mock('../src/routes/admin/utils', () => ({
  formatAccountExpiry: jest.fn((account) => account),
  mapExpiryField: jest.fn((updates) => updates)
}))
jest.mock('../src/utils/testPayloadHelper', () => ({
  createOpenAITestPayload: jest.fn(),
  createChatCompletionsTestPayload: jest.fn(),
  extractErrorMessage: jest.fn()
}))
jest.mock('../src/utils/proxyHelper', () => ({
  getProxyAgent: jest.fn()
}))

const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiResponsesUpstreamProbeService = require('../src/services/openaiProtocol/openaiResponsesUpstreamProbeService')
const openaiResponsesAccountsRouter = require('../src/routes/admin/openaiResponsesAccounts')

describe('admin openai-responses account maxConcurrentTasks validation', () => {
  const buildApp = () => {
    const app = express()
    app.use(express.json())
    app.use('/admin', openaiResponsesAccountsRouter)
    return app
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects invalid maxConcurrentTasks on create', async () => {
    const app = buildApp()

    const response = await request(app).post('/admin/openai-responses-accounts').send({
      name: 'Mimo',
      baseApi: 'https://example.com',
      apiKey: 'test',
      maxConcurrentTasks: -1
    })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: 'maxConcurrentTasks must be a non-negative integer'
    })
    expect(openaiResponsesAccountService.createAccount).not.toHaveBeenCalled()
  })

  it('rejects invalid maxConcurrentTasks on update', async () => {
    const app = buildApp()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-1',
      accountType: 'shared'
    })

    const response = await request(app).put('/admin/openai-responses-accounts/responses-1').send({
      maxConcurrentTasks: 1.5
    })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: 'maxConcurrentTasks must be a non-negative integer'
    })
    expect(openaiResponsesAccountService.updateAccount).not.toHaveBeenCalled()
  })

  it('tests account via upstream probe service and returns detected capabilities', async () => {
    const app = buildApp()
    openaiResponsesAccountService.getAccount.mockResolvedValue({
      id: 'responses-2',
      name: 'Probe Account',
      apiKey: 'secret-key'
    })
    openaiResponsesUpstreamProbeService.probeAccount.mockResolvedValue({
      accountId: 'responses-2',
      accountName: 'Probe Account',
      model: 'mimo-v2-pro',
      resolvedModel: 'mimo-v2-pro',
      latency: 321,
      responseText: 'OK',
      selectedUpstreamPath: '/v1/chat/completions',
      fallbackUsed: true,
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsReasoning: false,
        supportsJsonSchema: false
      }
    })

    const response = await request(app)
      .post('/admin/openai-responses-accounts/responses-2/test')
      .send({ model: 'mimo-v2-pro' })

    expect(response.status).toBe(200)
    expect(openaiResponsesUpstreamProbeService.probeAccount).toHaveBeenCalledWith(
      {
        id: 'responses-2',
        name: 'Probe Account',
        apiKey: 'secret-key'
      },
      { model: 'mimo-v2-pro' }
    )
    expect(response.body).toEqual({
      success: true,
      data: {
        accountId: 'responses-2',
        accountName: 'Probe Account',
        model: 'mimo-v2-pro',
        resolvedModel: 'mimo-v2-pro',
        latency: 321,
        responseText: 'OK',
        selectedUpstreamPath: '/v1/chat/completions',
        fallbackUsed: true,
        capabilities: {
          supportsStreaming: true,
          supportsTools: true,
          supportsReasoning: false,
          supportsJsonSchema: false
        }
      }
    })
  })
})
