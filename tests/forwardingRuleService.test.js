const { ForwardingRuleService } = require('../src/services/forwardingRuleService')

describe('ForwardingRuleService', () => {
  const buildMockRedis = () => {
    const hashes = new Map()
    const sets = new Map()

    const ensureSet = (key) => {
      if (!sets.has(key)) {
        sets.set(key, new Set())
      }
      return sets.get(key)
    }

    return {
      getClientSafe: () => ({
        hgetall: jest.fn(async (key) => ({ ...(hashes.get(key) || {}) })),
        hset: jest.fn(async (key, data) => {
          hashes.set(key, { ...(hashes.get(key) || {}), ...data })
        }),
        del: jest.fn(async (key) => {
          hashes.delete(key)
        }),
        smembers: jest.fn(async (key) => Array.from(sets.get(key) || []))
      }),
      addToIndex: jest.fn(async (key, id) => {
        ensureSet(key).add(id)
      }),
      removeFromIndex: jest.fn(async (key, id) => {
        sets.get(key)?.delete(id)
      }),
      batchHgetallChunked: jest.fn(async (keys) =>
        keys.map((key) => ({ ...(hashes.get(key) || {}) }))
      )
    }
  }

  const buildService = (redisMock, uuidSequence = []) => {
    let index = 0

    return new ForwardingRuleService({
      redis: redisMock,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      uuidFactory: () => uuidSequence[index++] || `rule-${index}`,
      accountProviders: {
        openai: {
          label: 'OpenAI 官方',
          runtimeSupported: true,
          fetchAccounts: async () => [{ id: 'openai-1', name: 'OpenAI One', platform: 'openai' }]
        },
        'openai-responses': {
          label: 'OpenAI Responses',
          runtimeSupported: true,
          fetchAccounts: async () => [
            { id: 'responses-1', name: 'Responses One', platform: 'openai-responses' }
          ]
        }
      }
    })
  }

  it('sorts rules by enabled state and priority in the rule list', async () => {
    const redisMock = buildMockRedis()
    const service = buildService(redisMock, ['rule-low', 'rule-high', 'rule-disabled'])

    await service.createRule({
      name: 'Low Priority',
      platform: 'openai',
      sourceModel: 'gpt-4o',
      targetModel: 'upstream-low',
      priority: 10
    })
    await service.createRule({
      name: 'High Priority',
      platform: 'openai',
      sourceModel: 'gpt-5.4',
      targetModel: 'upstream-high',
      priority: 500
    })
    await service.createRule({
      name: 'Disabled Rule',
      platform: 'openai',
      sourceModel: 'gpt-4.1',
      targetModel: 'upstream-disabled',
      priority: 900,
      enabled: false
    })

    const rules = await service.getAllRules({ platform: 'openai' })
    expect(rules.map((rule) => rule.id)).toEqual(['rule-high', 'rule-low', 'rule-disabled'])
  })

  it('prefers account-scoped rules over platform-scoped rules during resolution', async () => {
    const redisMock = buildMockRedis()
    const service = buildService(redisMock, ['platform-rule', 'account-rule'])

    await service.createRule({
      name: 'Platform Rule',
      platform: 'openai-responses',
      sourceModel: 'gpt-5.4',
      targetModel: 'st/OpenAI/gpt-5.4-platform',
      priority: 999
    })
    await service.createRule({
      name: 'Account Rule',
      platform: 'openai-responses',
      accountId: 'responses-1',
      sourceModel: 'gpt-5.4',
      targetModel: 'st/OpenAI/gpt-5.4-account',
      priority: 1
    })

    const resolution = await service.resolveModel({
      platform: 'openai-responses',
      accountId: 'responses-1',
      requestedModel: 'gpt-5.4'
    })

    expect(resolution.matched).toBe(true)
    expect(resolution.resolvedModel).toBe('st/OpenAI/gpt-5.4-account')
    expect(resolution.rule.id).toBe('account-rule')
  })

  it('keeps the original model when no forwarding rule matches', async () => {
    const redisMock = buildMockRedis()
    const service = buildService(redisMock, ['rule-1'])

    await service.createRule({
      platform: 'openai-responses',
      sourceModel: 'gpt-5.4',
      targetModel: 'st/OpenAI/gpt-5.4-2026-03-05'
    })

    const requestBody = { model: 'gpt-4.1' }
    const resolution = await service.rewriteRequestModel({
      requestBody,
      platform: 'openai-responses',
      accountId: 'responses-1'
    })

    expect(resolution.matched).toBe(false)
    expect(resolution.resolvedModel).toBe('gpt-4.1')
    expect(requestBody.model).toBe('gpt-4.1')
  })

  it('filters account options by platform and keyword', async () => {
    const redisMock = buildMockRedis()
    const service = new ForwardingRuleService({
      redis: redisMock,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      accountProviders: {
        openai: {
          label: 'OpenAI 官方',
          runtimeSupported: true,
          fetchAccounts: async () => [
            { id: 'openai-1', name: 'Alpha Account', platform: 'openai' },
            { id: 'openai-2', name: 'Beta Account', platform: 'openai' }
          ]
        },
        'openai-responses': {
          label: 'OpenAI Responses',
          runtimeSupported: true,
          fetchAccounts: async () => [
            { id: 'responses-1', name: 'Responses One', platform: 'openai-responses' }
          ]
        }
      }
    })

    const keywordMatched = await service.getAccountOptions('openai', 'alpha')
    expect(keywordMatched.accounts).toHaveLength(1)
    expect(keywordMatched.accounts[0].id).toBe('openai-1')

    const idMatched = await service.getAccountOptions('openai', 'openai-2')
    expect(idMatched.accounts).toHaveLength(1)
    expect(idMatched.accounts[0].name).toBe('Beta Account')

    const crossPlatformFiltered = await service.getAccountOptions('openai', 'responses')
    expect(crossPlatformFiltered.accounts).toHaveLength(0)
  })
})
