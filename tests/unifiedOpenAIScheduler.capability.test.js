jest.mock('../src/services/account/openaiAccountService', () => ({
  getAllAccounts: jest.fn().mockResolvedValue([]),
  getAccount: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  refreshAccountToken: jest.fn(),
  recordUsage: jest.fn()
}))

jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAllAccounts: jest.fn(),
  getAccount: jest.fn(),
  checkAndClearRateLimit: jest.fn().mockResolvedValue(true),
  isSubscriptionExpired: jest.fn(() => false),
  recordUsage: jest.fn(),
  normalizeProviderEndpoint: jest.fn((value) => value || 'responses'),
  isModelSupported: jest.fn((modelMapping, requestedModel) => {
    if (!modelMapping || Object.keys(modelMapping).length === 0) {
      return true
    }

    return Object.keys(modelMapping).some(
      (key) => key.toLowerCase() === String(requestedModel || '').toLowerCase()
    )
  })
}))

jest.mock('../src/services/accountGroupService', () => ({
  getGroup: jest.fn(),
  getGroupMembers: jest.fn()
}))

jest.mock('../src/models/redis', () => ({
  getClientSafe: jest.fn()
}))

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

jest.mock('../src/utils/commonHelper', () => ({
  isSchedulable: jest.fn((value) => value !== false && value !== 'false'),
  sortAccountsByPriority: jest.fn((accounts) => accounts)
}))

jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn().mockResolvedValue(false)
}))

const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const scheduler = require('../src/services/scheduler/unifiedOpenAIScheduler')

describe('unifiedOpenAIScheduler capability filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([
      {
        id: 'responses-1',
        name: 'Mimo Chat',
        isActive: true,
        status: 'active',
        accountType: 'shared',
        schedulable: true,
        providerEndpoint: 'completions',
        priority: '50'
      }
    ])
    openaiResponsesAccountService.checkAndClearRateLimit.mockResolvedValue(true)
    openaiResponsesAccountService.isSubscriptionExpired.mockReturnValue(false)
  })

  it('skips completions-only accounts for json_schema requests by default', async () => {
    await expect(
      scheduler.selectAccountForApiKey({ id: 'key-1', name: 'Key One' }, null, 'mimo-v2-pro', {
        needsStreaming: false,
        needsTools: false,
        needsReasoning: false,
        needsJsonSchema: true
      })
    ).rejects.toThrow('No available OpenAI accounts support the requested features')
  })

  it('allows completions accounts when json_schema support is explicitly enabled', async () => {
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([
      {
        id: 'responses-2',
        name: 'Mimo Chat JSON',
        isActive: true,
        status: 'active',
        accountType: 'shared',
        schedulable: true,
        providerEndpoint: 'completions',
        supportsJsonSchema: 'true',
        priority: '40'
      }
    ])

    await expect(
      scheduler.selectAccountForApiKey({ id: 'key-2', name: 'Key Two' }, null, 'mimo-v2-pro', {
        needsStreaming: false,
        needsTools: false,
        needsReasoning: false,
        needsJsonSchema: true
      })
    ).resolves.toEqual({
      accountId: 'responses-2',
      accountType: 'openai-responses'
    })
  })

  it('treats account-level model mapping keys as schedulable client models', async () => {
    openaiResponsesAccountService.getAllAccounts.mockResolvedValue([
      {
        id: 'responses-3',
        name: 'Mimo Codex',
        isActive: true,
        status: 'active',
        accountType: 'shared',
        schedulable: true,
        providerEndpoint: 'completions',
        modelMapping: {
          'gpt-5': 'codex-0.80'
        },
        priority: '30'
      }
    ])

    await expect(
      scheduler.selectAccountForApiKey({ id: 'key-3', name: 'Key Three' }, null, 'gpt-5', {
        needsStreaming: false,
        needsTools: false,
        needsReasoning: false,
        needsJsonSchema: false
      })
    ).resolves.toEqual({
      accountId: 'responses-3',
      accountType: 'openai-responses'
    })

    expect(openaiResponsesAccountService.isModelSupported).toHaveBeenCalledWith(
      {
        'gpt-5': 'codex-0.80'
      },
      'gpt-5'
    )
  })
})
