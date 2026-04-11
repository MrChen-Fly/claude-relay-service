const config = require('../../../config/config')
const redis = require('../../models/redis')
const logger = require('../../utils/logger')

const DEFAULT_WINDOW_MINUTES = 60
const MAX_WINDOW_MINUTES = 24 * 60
const DEFAULT_BUCKET_TTL_SECONDS = 7 * 24 * 60 * 60
const BYPASS_REASON_PREFIX = 'bypassReason:'
const SEMANTIC_SKIP_REASON_PREFIX = 'semanticSkipReason:'
const COUNTER_FIELDS = [
  'requests',
  'eligibleRequests',
  'hits',
  'misses',
  'bypasses',
  'stores',
  'exactHits',
  'toolResultHits',
  'toolResultStores',
  'semanticHits',
  'semanticChunkedRequests',
  'semanticChunkedChunks',
  'semanticSkips',
  'semanticVerifiedHits',
  'grayZoneChecks',
  'providerCalls',
  'providerErrors',
  'providerPromptCacheRequests',
  'providerPromptCacheReadRequests',
  'providerPromptCacheWriteRequests',
  'providerPromptCacheReadTokens',
  'providerPromptCacheWriteTokens'
]

function toSafeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function clampWindowMinutes(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WINDOW_MINUTES
  }

  return Math.min(MAX_WINDOW_MINUTES, parsed)
}

function createEmptyCounterSet() {
  return COUNTER_FIELDS.reduce((accumulator, field) => {
    accumulator[field] = 0
    return accumulator
  }, {})
}

function mergeCounterSets(target, source = {}) {
  const merged = target
  for (const field of COUNTER_FIELDS) {
    merged[field] += toSafeInteger(source[field])
  }

  for (const [field, value] of Object.entries(source)) {
    if (!field.startsWith(BYPASS_REASON_PREFIX) && !field.startsWith(SEMANTIC_SKIP_REASON_PREFIX)) {
      continue
    }

    merged[field] = (merged[field] || 0) + toSafeInteger(value)
  }

  return merged
}

function toRatio(numerator, denominator) {
  if (!denominator) {
    return 0
  }

  return Number((numerator / denominator).toFixed(4))
}

function buildSummary(counterSet = {}) {
  const counters = mergeCounterSets(createEmptyCounterSet(), counterSet)

  return {
    requests: counters.requests,
    eligibleRequests: counters.eligibleRequests,
    hits: counters.hits,
    misses: counters.misses,
    bypasses: counters.bypasses,
    stores: counters.stores,
    exactHits: counters.exactHits,
    toolResultHits: counters.toolResultHits,
    toolResultStores: counters.toolResultStores,
    semanticHits: counters.semanticHits,
    semanticChunkedRequests: counters.semanticChunkedRequests,
    semanticChunkedChunks: counters.semanticChunkedChunks,
    semanticSkips: counters.semanticSkips,
    semanticVerifiedHits: counters.semanticVerifiedHits,
    grayZoneChecks: counters.grayZoneChecks,
    providerCalls: counters.providerCalls,
    providerErrors: counters.providerErrors,
    providerPromptCacheRequests: counters.providerPromptCacheRequests,
    providerPromptCacheReadRequests: counters.providerPromptCacheReadRequests,
    providerPromptCacheWriteRequests: counters.providerPromptCacheWriteRequests,
    providerPromptCacheReadTokens: counters.providerPromptCacheReadTokens,
    providerPromptCacheWriteTokens: counters.providerPromptCacheWriteTokens,
    hitRate: toRatio(counters.hits, counters.eligibleRequests),
    missRate: toRatio(counters.misses, counters.eligibleRequests),
    eligibleRate: toRatio(counters.eligibleRequests, counters.requests),
    bypassRate: toRatio(counters.bypasses, counters.requests),
    storeRate: toRatio(counters.stores, counters.eligibleRequests),
    exactHitShare: toRatio(counters.exactHits, counters.hits),
    toolResultHitShare: toRatio(counters.toolResultHits, counters.hits),
    semanticHitShare: toRatio(counters.semanticHits, counters.hits),
    semanticSkipShare: toRatio(counters.semanticSkips, counters.eligibleRequests),
    semanticVerifiedShare: toRatio(counters.semanticVerifiedHits, counters.semanticHits),
    providerPromptCacheRequestRate: toRatio(
      counters.providerPromptCacheRequests,
      counters.requests
    ),
    providerErrorRate: toRatio(counters.providerErrors, counters.providerCalls)
  }
}

function buildBypassReasonBreakdown(counterSet = {}) {
  return Object.entries(counterSet)
    .filter(([field]) => field.startsWith(BYPASS_REASON_PREFIX))
    .map(([field, value]) => ({
      reason: field.slice(BYPASS_REASON_PREFIX.length),
      count: toSafeInteger(value)
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
}

function buildSemanticSkipReasonBreakdown(counterSet = {}) {
  return Object.entries(counterSet)
    .filter(([field]) => field.startsWith(SEMANTIC_SKIP_REASON_PREFIX))
    .map(([field, value]) => ({
      reason: field.slice(SEMANTIC_SKIP_REASON_PREFIX.length),
      count: toSafeInteger(value)
    }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
}

class TokenCacheMetricsService {
  constructor(options = {}) {
    this.redis = options.redis || redis
    this.tokenCacheConfig = options.config || config.tokenCache || {}
    this.defaultWindowMinutes = clampWindowMinutes(options.defaultWindowMinutes)
    this.bucketTtlSeconds =
      Number.parseInt(options.bucketTtlSeconds, 10) || DEFAULT_BUCKET_TTL_SECONDS
    this.namespace = this.tokenCacheConfig.namespace || 'token_cache:openai_responses'
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

  _getTotalKey() {
    return `${this.namespace}:metrics:total`
  }

  _getMinuteKey(minuteId) {
    return `${this.namespace}:metrics:minute:${minuteId}`
  }

  _getMinuteId(date = Date.now()) {
    return Math.floor(new Date(date).getTime() / 60000)
  }

  _sanitizeFields(fields = {}) {
    const sanitized = {}

    for (const [field, value] of Object.entries(fields)) {
      const delta = toSafeInteger(value)
      if (!delta) {
        continue
      }

      sanitized[field] = delta
    }

    return sanitized
  }

  _buildConfigSnapshot() {
    return {
      enabled: Boolean(this.tokenCacheConfig.enabled),
      semanticEnabled: Boolean(this.tokenCacheConfig.semanticEnabled),
      namespace: this.namespace,
      ttlSeconds: Number.parseInt(this.tokenCacheConfig.ttlSeconds, 10) || 0,
      maxEntries: Number.parseInt(this.tokenCacheConfig.maxEntries, 10) || 0,
      highThreshold: Number(this.tokenCacheConfig.highThreshold) || 0,
      lowThreshold: Number(this.tokenCacheConfig.lowThreshold) || 0,
      grayZoneVerifierEnabled: this.tokenCacheConfig.enableGrayZoneVerifier !== false,
      useANNIndex: this.tokenCacheConfig.useANNIndex !== false,
      baseUrl: this.tokenCacheConfig.openaiBaseUrl || '',
      embedModel: this.tokenCacheConfig.openaiEmbedModel || '',
      embedInputStrategy: this.tokenCacheConfig.openaiEmbedInputStrategy || 'skip',
      embedMaxInputChars: Number.parseInt(this.tokenCacheConfig.openaiEmbedMaxInputChars, 10) || 0,
      embedMaxInputBytes: Number.parseInt(this.tokenCacheConfig.openaiEmbedMaxInputBytes, 10) || 0,
      embedChunkMaxChunks:
        Number.parseInt(this.tokenCacheConfig.openaiEmbedChunkMaxChunks, 10) || 0,
      embedChunkOverlapChars:
        Number.parseInt(this.tokenCacheConfig.openaiEmbedChunkOverlapChars, 10) || 0,
      verifyModel: this.tokenCacheConfig.openaiVerifyModel || '',
      toolResultEnabled: Boolean(this.tokenCacheConfig.toolResultEnabled),
      toolResultTtlSeconds: Number.parseInt(this.tokenCacheConfig.toolResultTtlSeconds, 10) || 0,
      toolResultAllowedToolsCount: Array.isArray(this.tokenCacheConfig.toolResultAllowedTools)
        ? this.tokenCacheConfig.toolResultAllowedTools.length
        : 0,
      requestTimeoutMs: Number.parseInt(this.tokenCacheConfig.requestTimeoutMs, 10) || 0
    }
  }

  async record(fields = {}) {
    const client = this._getClient()
    const deltas = this._sanitizeFields(fields)
    if (!client || Object.keys(deltas).length === 0) {
      return false
    }

    const minuteKey = this._getMinuteKey(this._getMinuteId())
    const pipeline = client.pipeline()

    for (const [field, delta] of Object.entries(deltas)) {
      pipeline.hincrby(this._getTotalKey(), field, delta)
      pipeline.hincrby(minuteKey, field, delta)
    }

    pipeline.expire(minuteKey, this.bucketTtlSeconds)
    await pipeline.exec()
    return true
  }

  recordAsync(fields = {}) {
    Promise.resolve(this.record(fields)).catch((error) => {
      logger.warn('Token cache metrics record failed:', error.message)
    })
  }

  async getSnapshot(windowMinutes = this.defaultWindowMinutes) {
    const client = this._getClient()
    const normalizedWindowMinutes = clampWindowMinutes(windowMinutes)
    const configSnapshot = this._buildConfigSnapshot()

    if (!client) {
      return {
        enabled: configSnapshot.enabled,
        windowMinutes: normalizedWindowMinutes,
        recent: buildSummary(),
        total: buildSummary(),
        bypassReasons: {
          recent: [],
          total: []
        },
        semanticSkipReasons: {
          recent: [],
          total: []
        },
        config: configSnapshot
      }
    }

    const totalPromise = client.hgetall(this._getTotalKey())
    const currentMinuteId = this._getMinuteId()
    const pipeline = client.pipeline()
    for (let offset = 0; offset < normalizedWindowMinutes; offset += 1) {
      pipeline.hgetall(this._getMinuteKey(currentMinuteId - offset))
    }

    const [totalCounters, bucketResults] = await Promise.all([totalPromise, pipeline.exec()])
    const recentCounters = createEmptyCounterSet()
    for (const [error, counters] of bucketResults || []) {
      if (error || !counters) {
        continue
      }

      mergeCounterSets(recentCounters, counters)
    }

    return {
      enabled: configSnapshot.enabled,
      windowMinutes: normalizedWindowMinutes,
      recent: buildSummary(recentCounters),
      total: buildSummary(totalCounters),
      bypassReasons: {
        recent: buildBypassReasonBreakdown(recentCounters),
        total: buildBypassReasonBreakdown(totalCounters)
      },
      semanticSkipReasons: {
        recent: buildSemanticSkipReasonBreakdown(recentCounters),
        total: buildSemanticSkipReasonBreakdown(totalCounters)
      },
      config: configSnapshot
    }
  }
}

const tokenCacheMetricsService = new TokenCacheMetricsService()

module.exports = tokenCacheMetricsService
module.exports.TokenCacheMetricsService = TokenCacheMetricsService
module.exports.createEmptyCounterSet = createEmptyCounterSet
