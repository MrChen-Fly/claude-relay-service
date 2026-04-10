const config = require('../../../config/config')
const redis = require('../../models/redis')
const logger = require('../../utils/logger')

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const DEFAULT_MAX_RECORDS = 500
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60

function parsePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(parsed, max)
}

function normalizeString(value, maxLength = 256) {
  if (value === undefined || value === null) {
    return ''
  }

  const normalized = String(value).trim()
  if (!normalized) {
    return ''
  }

  return normalized.slice(0, maxLength)
}

function normalizeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

class TokenCacheDiagnosticsService {
  constructor(options = {}) {
    this.redis = options.redis || redis
    this.tokenCacheConfig = options.config || config.tokenCache || {}
    this.namespace = this.tokenCacheConfig.namespace || 'token_cache:openai_responses'
    this.maxRecords = parsePositiveInteger(options.maxRecords, DEFAULT_MAX_RECORDS, 5000)
    this.ttlSeconds = parsePositiveInteger(options.ttlSeconds, DEFAULT_TTL_SECONDS)
  }

  _getClient() {
    if (this.redis?.isConnected === false) {
      return null
    }

    if (typeof this.redis?.getClient === 'function') {
      return this.redis.getClient()
    }

    return this.redis?.client || null
  }

  _getListKey() {
    return `${this.namespace}:diagnostics:recent`
  }

  _sanitizeEvent(event = {}) {
    const eventType = normalizeString(event.eventType, 64)
    if (!eventType) {
      return null
    }

    const timestamp = Math.max(0, Number.parseInt(event.timestamp, 10) || Date.now())
    const sanitized = {
      timestamp,
      eventType
    }

    const stringFields = [
      'layer',
      'reason',
      'provider',
      'accountId',
      'accountName',
      'requestedModel',
      'promptCacheKey',
      'sessionHash',
      'conversationId',
      'cacheKey',
      'scopeKey',
      'cacheStrategy',
      'promptHash',
      'transcriptHash',
      'systemHash'
    ]

    for (const field of stringFields) {
      const normalized = normalizeString(event[field])
      if (normalized) {
        sanitized[field] = normalized
      }
    }

    const numericFields = [
      'score',
      'statusCode',
      'toolCandidateCount',
      'messageCount',
      'promptLength',
      'transcriptLength',
      'systemLength'
    ]

    for (const field of numericFields) {
      if (event[field] === undefined || event[field] === null || event[field] === '') {
        continue
      }

      sanitized[field] = normalizeNumber(event[field])
    }

    if (event.semanticEligible !== undefined) {
      sanitized.semanticEligible = Boolean(event.semanticEligible)
    }

    return sanitized
  }

  async record(event = {}) {
    const client = this._getClient()
    const payload = this._sanitizeEvent(event)
    if (!client || !payload) {
      return false
    }

    await client
      .multi()
      .lpush(this._getListKey(), JSON.stringify(payload))
      .ltrim(this._getListKey(), 0, Math.max(0, this.maxRecords - 1))
      .expire(this._getListKey(), this.ttlSeconds)
      .exec()

    return true
  }

  recordAsync(event = {}) {
    Promise.resolve(this.record(event)).catch((error) => {
      logger.warn('Token cache diagnostics record failed:', error.message)
    })
  }

  async list(options = {}) {
    const client = this._getClient()
    if (!client) {
      return []
    }

    const limit = parsePositiveInteger(options.limit, DEFAULT_LIMIT, MAX_LIMIT)
    const promptCacheKey = normalizeString(options.promptCacheKey)
    const sessionHash = normalizeString(options.sessionHash)
    const eventType = normalizeString(options.eventType, 64)
    const fetchCount = Math.min(this.maxRecords, Math.max(limit * 5, 200))

    const rawItems = await client.lrange(this._getListKey(), 0, Math.max(0, fetchCount - 1))
    const items = rawItems
      .map((rawItem) => {
        try {
          return JSON.parse(rawItem)
        } catch (error) {
          logger.warn('Failed to parse token cache diagnostic record:', error.message)
          return null
        }
      })
      .filter(Boolean)
      .filter((item) => {
        if (promptCacheKey && item.promptCacheKey !== promptCacheKey) {
          return false
        }

        if (sessionHash && item.sessionHash !== sessionHash) {
          return false
        }

        if (eventType && item.eventType !== eventType) {
          return false
        }

        return true
      })

    return items.slice(0, limit)
  }
}

const tokenCacheDiagnosticsService = new TokenCacheDiagnosticsService()

module.exports = tokenCacheDiagnosticsService
module.exports.TokenCacheDiagnosticsService = TokenCacheDiagnosticsService
