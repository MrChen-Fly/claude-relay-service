const { v4: uuidv4 } = require('uuid')
const redis = require('../models/redis')
const logger = require('../utils/logger')

const DEFAULT_PRIORITY = 100

function buildDefaultAccountProviders() {
  return {
    claude: {
      label: 'Claude 官方 / OAuth',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/claudeAccountService').getAllAccounts(true)
    },
    'claude-console': {
      label: 'Claude Console',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/claudeConsoleAccountService').getAllAccounts(true)
    },
    bedrock: {
      label: 'AWS Bedrock',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/bedrockAccountService').getAllAccounts(true)
    },
    ccr: {
      label: 'CCR Relay',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/ccrAccountService').getAllAccounts(true)
    },
    gemini: {
      label: 'Gemini OAuth',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/geminiAccountService').getAllAccounts(true)
    },
    'gemini-api': {
      label: 'Gemini API',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/geminiApiAccountService').getAllAccounts(true)
    },
    openai: {
      label: 'OpenAI 官方',
      runtimeSupported: true,
      fetchAccounts: () => require('./account/openaiAccountService').getAllAccounts(true)
    },
    'openai-responses': {
      label: 'OpenAI Responses',
      runtimeSupported: true,
      fetchAccounts: () => require('./account/openaiResponsesAccountService').getAllAccounts(true)
    },
    'azure-openai': {
      label: 'Azure OpenAI',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/azureOpenaiAccountService').getAllAccounts(true)
    },
    droid: {
      label: 'Droid',
      runtimeSupported: false,
      fetchAccounts: () => require('./account/droidAccountService').getAllAccounts(true)
    }
  }
}

class ForwardingRuleService {
  constructor(deps = {}) {
    this.redis = deps.redis || redis
    this.logger = deps.logger || logger
    this.uuidFactory = deps.uuidFactory || uuidv4
    this.accountProviders = deps.accountProviders || buildDefaultAccountProviders()

    this.RULE_KEY_PREFIX = 'forwarding_rule:'
    this.ALL_INDEX_KEY = 'forwarding_rule:index'
    this.ENABLED_INDEX_KEY = 'forwarding_rule:index:enabled'
  }

  getSupportedPlatforms() {
    return Object.entries(this.accountProviders).map(([value, meta]) => ({
      value,
      label: meta.label,
      runtimeSupported: meta.runtimeSupported === true
    }))
  }

  normalizePlatform(platform) {
    const normalized = String(platform || '')
      .trim()
      .toLowerCase()
    if (!normalized) {
      return ''
    }

    const aliases = {
      claude: 'claude',
      'claude-oauth': 'claude',
      'claude-console': 'claude-console',
      bedrock: 'bedrock',
      ccr: 'ccr',
      gemini: 'gemini',
      'gemini-api': 'gemini-api',
      openai: 'openai',
      'openai-responses': 'openai-responses',
      azure_openai: 'azure-openai',
      'azure-openai': 'azure-openai',
      droid: 'droid'
    }

    return aliases[normalized] || normalized
  }

  normalizeModel(model, platform = '') {
    const rawModel = String(model || '').trim()
    if (!rawModel) {
      return ''
    }

    const normalizedPlatform = this.normalizePlatform(platform)
    let normalizedModel = rawModel.toLowerCase()

    if (normalizedPlatform === 'gemini' || normalizedPlatform === 'gemini-api') {
      normalizedModel = normalizedModel.replace(/^models\//, '')
    }

    return normalizedModel
  }

  async getAccountOptions(platform = '', keyword = '') {
    const normalizedPlatform = this.normalizePlatform(platform)
    const normalizedKeyword = String(keyword || '')
      .trim()
      .toLowerCase()
    const platformEntries = this.getSupportedPlatforms()
    const targetPlatforms = normalizedPlatform
      ? platformEntries.filter((item) => item.value === normalizedPlatform)
      : platformEntries

    const accountLists = await Promise.all(
      targetPlatforms.map(async (item) => {
        const provider = this.accountProviders[item.value]
        const accounts = await this._fetchAccounts(provider)
        const formattedAccounts = accounts.map((account) =>
          this._formatAccountOption(account, item)
        )
        return {
          platform: item.value,
          label: item.label,
          runtimeSupported: item.runtimeSupported,
          accounts: normalizedKeyword
            ? formattedAccounts.filter((account) =>
                this._matchesAccountKeyword(account, normalizedKeyword)
              )
            : formattedAccounts
        }
      })
    )

    return {
      platforms: platformEntries,
      accounts: accountLists.flatMap((item) => item.accounts),
      groupedAccounts: accountLists
    }
  }

  async createRule(payload = {}) {
    const now = new Date().toISOString()
    const rule = await this._buildRuleRecord(payload, {
      ruleId: this.uuidFactory(),
      createdAt: now,
      updatedAt: now
    })

    await this._assertNoConflict(rule)
    await this._saveRule(rule)

    this.logger.info(
      `Created forwarding rule ${rule.id}: ${rule.platform} ${rule.sourceModel} -> ${rule.targetModel}`
    )

    return rule
  }

  async getRule(ruleId) {
    const ruleData = await this._loadRuleRaw(ruleId)
    return ruleData ? this._deserializeRule(ruleData) : null
  }

  async getAllRules(filters = {}) {
    const normalizedPlatform = this.normalizePlatform(filters.platform)
    const accountId = this._normalizeOptionalString(filters.accountId)
    const enabledFilter = this._parseEnabledFilter(filters.enabled)
    const keyword = String(filters.keyword || '')
      .trim()
      .toLowerCase()
    const candidateIds = await this._getListCandidateIds({
      platform: normalizedPlatform,
      accountId,
      enabled: enabledFilter
    })
    const rules = await this._loadRulesByIds(candidateIds)

    return rules
      .filter((rule) => {
        if (normalizedPlatform && rule.platform !== normalizedPlatform) {
          return false
        }
        if (accountId && rule.accountId !== accountId) {
          return false
        }
        if (enabledFilter !== null && rule.enabled !== enabledFilter) {
          return false
        }
        if (!keyword) {
          return true
        }

        return [rule.name, rule.sourceModel, rule.targetModel, rule.accountId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword))
      })
      .sort((left, right) => this._sortRulesForList(left, right))
  }

  async updateRule(ruleId, updates = {}) {
    const existingRule = await this.getRule(ruleId)
    if (!existingRule) {
      throw new Error('Forwarding rule not found')
    }

    const updatedRule = await this._buildRuleRecord(
      {
        ...existingRule,
        ...updates,
        id: ruleId,
        createdAt: existingRule.createdAt,
        updatedAt: new Date().toISOString()
      },
      { ruleId, createdAt: existingRule.createdAt }
    )

    await this._assertNoConflict(updatedRule, ruleId)
    await this._removeRuleIndexes(existingRule)
    await this._saveRule(updatedRule)

    this.logger.info(
      `Updated forwarding rule ${ruleId}: ${updatedRule.platform} ${updatedRule.sourceModel} -> ${updatedRule.targetModel}`
    )

    return updatedRule
  }

  async toggleRule(ruleId, enabled = null) {
    const existingRule = await this.getRule(ruleId)
    if (!existingRule) {
      throw new Error('Forwarding rule not found')
    }

    const nextEnabled = enabled === null ? !existingRule.enabled : this._normalizeBoolean(enabled)
    return this.updateRule(ruleId, { enabled: nextEnabled })
  }

  async deleteRule(ruleId) {
    const existingRule = await this.getRule(ruleId)
    if (!existingRule) {
      return { success: true }
    }

    const client = this.redis.getClientSafe()
    await this._removeRuleIndexes(existingRule)
    await client.del(this._getRuleKey(ruleId))

    this.logger.info(`Deleted forwarding rule ${ruleId}`)
    return { success: true }
  }

  async resolveModel({ platform, accountId = null, requestedModel = '' } = {}) {
    const normalizedPlatform = this.normalizePlatform(platform)
    const normalizedSourceModel = this.normalizeModel(requestedModel, normalizedPlatform)
    const normalizedAccountId = this._normalizeOptionalString(accountId)

    if (!normalizedPlatform || !normalizedSourceModel) {
      return {
        matched: false,
        requestedModel,
        normalizedSourceModel,
        resolvedModel: requestedModel,
        rule: null
      }
    }

    const candidateIds = await this._getLookupCandidateIds({
      platform: normalizedPlatform,
      accountId: normalizedAccountId,
      normalizedSourceModel
    })
    const rules = await this._loadRulesByIds(candidateIds)
    const matchedRule = rules
      .filter(
        (rule) =>
          rule.enabled &&
          rule.matchType === 'exact' &&
          rule.platform === normalizedPlatform &&
          rule.normalizedSourceModel === normalizedSourceModel &&
          (!rule.accountId || rule.accountId === normalizedAccountId)
      )
      .sort((left, right) => this._sortRulesForMatch(left, right, normalizedAccountId))[0]

    if (!matchedRule) {
      return {
        matched: false,
        requestedModel,
        normalizedSourceModel,
        resolvedModel: requestedModel,
        rule: null
      }
    }

    return {
      matched: true,
      requestedModel,
      normalizedSourceModel,
      resolvedModel: matchedRule.targetModel,
      rule: matchedRule
    }
  }

  async rewriteRequestModel({
    requestBody,
    platform,
    accountId = null,
    requestedModel = null
  } = {}) {
    const body = requestBody && typeof requestBody === 'object' ? requestBody : null
    const sourceModel =
      requestedModel !== null && requestedModel !== undefined ? requestedModel : body?.model

    if (!sourceModel || typeof sourceModel !== 'string') {
      return {
        matched: false,
        requestedModel: sourceModel,
        resolvedModel: sourceModel,
        rule: null
      }
    }

    const resolution = await this.resolveModel({
      platform,
      accountId,
      requestedModel: sourceModel
    })

    if (resolution.matched && body) {
      body.model = resolution.resolvedModel
      this.logger.info(
        `Applied forwarding rule ${resolution.rule.id}: ${platform} ${sourceModel} -> ${resolution.resolvedModel}`
      )
    }

    return resolution
  }

  async _buildRuleRecord(payload = {}, meta = {}) {
    const platform = this.normalizePlatform(payload.platform)
    const accountId = this._normalizeOptionalString(payload.accountId)
    const sourceModel = this._normalizeRequiredString(payload.sourceModel, 'sourceModel')
    const targetModel = this._normalizeRequiredString(payload.targetModel, 'targetModel')
    const matchType = String(payload.matchType || 'exact')
      .trim()
      .toLowerCase()

    if (!platform || !this.accountProviders[platform]) {
      throw new Error('platform is required and must be a supported platform')
    }
    if (matchType !== 'exact') {
      throw new Error('Only exact matchType is supported for now')
    }

    if (accountId) {
      await this._assertAccountExists(platform, accountId)
    }

    const normalizedSourceModel = this.normalizeModel(sourceModel, platform)
    if (!normalizedSourceModel) {
      throw new Error('sourceModel is required')
    }

    return {
      id: meta.ruleId || this._normalizeRequiredString(payload.id, 'id'),
      name: this._normalizeOptionalString(payload.name) || `${sourceModel} -> ${targetModel}`,
      platform,
      accountId,
      sourceModel,
      normalizedSourceModel,
      targetModel,
      matchType,
      priority: this._normalizePriority(payload.priority),
      enabled: this._normalizeBoolean(payload.enabled === undefined ? true : payload.enabled, true),
      createdAt: payload.createdAt || meta.createdAt || new Date().toISOString(),
      updatedAt: payload.updatedAt || new Date().toISOString()
    }
  }

  async _assertAccountExists(platform, accountId) {
    const { accounts } = await this.getAccountOptions(platform)
    const matchedAccount = accounts.find(
      (item) => item.id === accountId && item.platform === platform
    )
    if (!matchedAccount) {
      throw new Error('Selected account does not exist under the chosen platform')
    }
  }

  async _assertNoConflict(rule, excludeRuleId = '') {
    if (!rule.enabled || rule.matchType !== 'exact') {
      return
    }

    const client = this.redis.getClientSafe()
    const conflictIndexKey = rule.accountId
      ? this._getAccountModelIndexKey(rule.platform, rule.accountId, rule.normalizedSourceModel)
      : this._getPlatformModelIndexKey(rule.platform, rule.normalizedSourceModel)
    const candidateIds = await client.smembers(conflictIndexKey)
    const conflictIds = candidateIds.filter((id) => id && id !== excludeRuleId)

    if (conflictIds.length > 0) {
      throw new Error('An enabled exact-match rule already exists for this platform/account/model')
    }
  }

  async _saveRule(rule) {
    const client = this.redis.getClientSafe()
    await client.hset(this._getRuleKey(rule.id), this._serializeRule(rule))
    await this._addRuleIndexes(rule)
  }

  async _loadRuleRaw(ruleId) {
    if (!ruleId) {
      return null
    }

    const client = this.redis.getClientSafe()
    const ruleData = await client.hgetall(this._getRuleKey(ruleId))
    return ruleData && ruleData.id ? ruleData : null
  }

  async _loadRulesByIds(ids = []) {
    if (!ids || ids.length === 0) {
      return []
    }

    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    const keys = uniqueIds.map((id) => this._getRuleKey(id))
    const dataList = await this.redis.batchHgetallChunked(keys)

    return dataList
      .filter((ruleData) => ruleData && ruleData.id)
      .map((ruleData) => this._deserializeRule(ruleData))
  }

  async _getListCandidateIds({ platform = '', accountId = '', enabled = null } = {}) {
    const client = this.redis.getClientSafe()
    let indexKey = this.ALL_INDEX_KEY

    if (platform && accountId) {
      indexKey = this._getPlatformAccountIndexKey(platform, accountId)
    } else if (accountId) {
      indexKey = this._getAccountIndexKey(accountId)
    } else if (platform) {
      indexKey = this._getPlatformIndexKey(platform)
    } else if (enabled === true) {
      indexKey = this.ENABLED_INDEX_KEY
    }

    return client.smembers(indexKey)
  }

  async _getLookupCandidateIds({ platform, accountId = '', normalizedSourceModel }) {
    const client = this.redis.getClientSafe()
    const [accountIds, platformIds] = await Promise.all([
      accountId
        ? client.smembers(this._getAccountModelIndexKey(platform, accountId, normalizedSourceModel))
        : Promise.resolve([]),
      client.smembers(this._getPlatformModelIndexKey(platform, normalizedSourceModel))
    ])

    return Array.from(new Set([...accountIds, ...platformIds].filter(Boolean)))
  }

  async _addRuleIndexes(rule) {
    const indexKeys = [
      this.ALL_INDEX_KEY,
      this._getPlatformIndexKey(rule.platform),
      ...(rule.accountId
        ? [
            this._getAccountIndexKey(rule.accountId),
            this._getPlatformAccountIndexKey(rule.platform, rule.accountId)
          ]
        : [])
    ]

    if (rule.enabled) {
      indexKeys.push(
        this.ENABLED_INDEX_KEY,
        this._getPlatformModelIndexKey(rule.platform, rule.normalizedSourceModel)
      )
      if (rule.accountId) {
        indexKeys.push(
          this._getAccountModelIndexKey(rule.platform, rule.accountId, rule.normalizedSourceModel)
        )
      }
    }

    await Promise.all(indexKeys.map((indexKey) => this.redis.addToIndex(indexKey, rule.id)))
  }

  async _removeRuleIndexes(rule) {
    const indexKeys = [
      this.ALL_INDEX_KEY,
      this.ENABLED_INDEX_KEY,
      this._getPlatformIndexKey(rule.platform),
      this._getPlatformModelIndexKey(rule.platform, rule.normalizedSourceModel),
      ...(rule.accountId
        ? [
            this._getAccountIndexKey(rule.accountId),
            this._getPlatformAccountIndexKey(rule.platform, rule.accountId),
            this._getAccountModelIndexKey(rule.platform, rule.accountId, rule.normalizedSourceModel)
          ]
        : [])
    ]

    await Promise.all(indexKeys.map((indexKey) => this.redis.removeFromIndex(indexKey, rule.id)))
  }

  async _fetchAccounts(provider) {
    if (!provider || typeof provider.fetchAccounts !== 'function') {
      return []
    }

    try {
      const result = await provider.fetchAccounts()
      if (Array.isArray(result)) {
        return result
      }
      if (Array.isArray(result?.data)) {
        return result.data
      }
      if (Array.isArray(result?.accounts)) {
        return result.accounts
      }
      return []
    } catch (error) {
      this.logger.warn(
        `Failed to load forwarding account options for ${provider.label}: ${error.message}`
      )
      return []
    }
  }

  _formatAccountOption(account, platformMeta) {
    const platform = this.normalizePlatform(account.platform || platformMeta.value)
    const id = String(account.id || '').trim()
    const name = String(account.name || account.description || id || 'Unnamed Account').trim()
    const description = String(
      account.description || account.email || account.username || account.remark || ''
    ).trim()
    const isActive = this._normalizeBoolean(account.isActive, true)
    const schedulable = this._normalizeBoolean(
      account.schedulable === undefined ? true : account.schedulable,
      true
    )

    return {
      id,
      platform,
      name,
      description,
      label: `${name}${isActive ? '' : ' (已停用)'}`,
      isActive,
      schedulable,
      runtimeSupported: platformMeta.runtimeSupported === true
    }
  }

  _matchesAccountKeyword(account, keyword) {
    return [account.id, account.name, account.label, account.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
  }

  _serializeRule(rule) {
    return {
      id: rule.id,
      name: rule.name,
      platform: rule.platform,
      accountId: rule.accountId || '',
      sourceModel: rule.sourceModel,
      normalizedSourceModel: rule.normalizedSourceModel,
      targetModel: rule.targetModel,
      matchType: rule.matchType,
      priority: String(rule.priority),
      enabled: String(rule.enabled),
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt
    }
  }

  _deserializeRule(ruleData) {
    return {
      id: ruleData.id,
      name: ruleData.name,
      platform: this.normalizePlatform(ruleData.platform),
      accountId: this._normalizeOptionalString(ruleData.accountId),
      sourceModel: ruleData.sourceModel,
      normalizedSourceModel:
        ruleData.normalizedSourceModel ||
        this.normalizeModel(ruleData.sourceModel, ruleData.platform),
      targetModel: ruleData.targetModel,
      matchType: ruleData.matchType || 'exact',
      priority: this._normalizePriority(ruleData.priority),
      enabled: this._normalizeBoolean(ruleData.enabled, true),
      createdAt: ruleData.createdAt || '',
      updatedAt: ruleData.updatedAt || '',
      scopeType: ruleData.accountId ? 'account' : 'platform'
    }
  }

  _sortRulesForList(left, right) {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1
    }
    if (left.priority !== right.priority) {
      return right.priority - left.priority
    }
    return this._toTimestamp(right.updatedAt) - this._toTimestamp(left.updatedAt)
  }

  _sortRulesForMatch(left, right, accountId) {
    const leftScope = left.accountId && left.accountId === accountId ? 1 : 0
    const rightScope = right.accountId && right.accountId === accountId ? 1 : 0

    if (leftScope !== rightScope) {
      return rightScope - leftScope
    }
    if (left.priority !== right.priority) {
      return right.priority - left.priority
    }
    return this._toTimestamp(right.updatedAt) - this._toTimestamp(left.updatedAt)
  }

  _parseEnabledFilter(value) {
    if (value === undefined || value === null || value === '') {
      return null
    }
    return this._normalizeBoolean(value, false)
  }

  _normalizePriority(value) {
    const priority = Number(value)
    if (!Number.isFinite(priority)) {
      return DEFAULT_PRIORITY
    }
    return Math.max(0, Math.min(100000, Math.round(priority)))
  }

  _normalizeOptionalString(value) {
    const normalized = String(value || '').trim()
    return normalized || null
  }

  _normalizeRequiredString(value, fieldName) {
    const normalized = String(value || '').trim()
    if (!normalized) {
      throw new Error(`${fieldName} is required`)
    }
    return normalized
  }

  _normalizeBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
      return defaultValue
    }
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'number') {
      return value !== 0
    }

    const normalized = String(value).trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false
    }

    return defaultValue
  }

  _toTimestamp(value) {
    const timestamp = Date.parse(value || '')
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  _getRuleKey(ruleId) {
    return `${this.RULE_KEY_PREFIX}${ruleId}`
  }

  _getPlatformIndexKey(platform) {
    return `${this.ALL_INDEX_KEY}:platform:${platform}`
  }

  _getAccountIndexKey(accountId) {
    return `${this.ALL_INDEX_KEY}:account:${accountId}`
  }

  _getPlatformAccountIndexKey(platform, accountId) {
    return `${this.ALL_INDEX_KEY}:platform:${platform}:account:${accountId}`
  }

  _getPlatformModelIndexKey(platform, normalizedSourceModel) {
    return `${this.ALL_INDEX_KEY}:platform:${platform}:model:${normalizedSourceModel}`
  }

  _getAccountModelIndexKey(platform, accountId, normalizedSourceModel) {
    return `${this.ALL_INDEX_KEY}:platform:${platform}:account:${accountId}:model:${normalizedSourceModel}`
  }
}

const forwardingRuleService = new ForwardingRuleService()

module.exports = forwardingRuleService
module.exports.ForwardingRuleService = ForwardingRuleService
