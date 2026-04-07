const crypto = require('crypto')
const config = require('../../../config/config')
const redis = require('../../models/redis')

const CACHE_VERSION = 'v1'
const REQUEST_HEADER_WHITELIST = ['openai-beta', 'openai-version', 'version']
const RESPONSE_HEADER_WHITELIST = [
  'x-request-id',
  'openai-version',
  'openai-processing-ms',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens'
]
const NUMERIC_REQUEST_FIELDS = new Set([
  'temperature',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'n',
  'max_output_tokens'
])
const OMITTED_REQUEST_FIELDS = new Set([
  'stream',
  'prompt_cache_key',
  'promptCacheKey',
  'session_id',
  'conversation_id'
])
const DYNAMIC_REQUEST_FIELDS = [
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'background',
  'web_search_options',
  'response_format'
]

function getSettings() {
  return {
    enabled: config.openaiCache?.enabled !== false,
    defaultTtlSeconds: config.openaiCache?.defaultTtlSeconds || 86400,
    embeddingsTtlSeconds: config.openaiCache?.embeddingsTtlSeconds || 604800,
    lockTtlSeconds: config.openaiCache?.lockTtlSeconds || 15,
    waitTimeoutMs: config.openaiCache?.waitTimeoutMs || 3000,
    waitPollMs: config.openaiCache?.waitPollMs || 100,
    maxCacheableTemperature:
      typeof config.openaiCache?.maxCacheableTemperature === 'number'
        ? config.openaiCache.maxCacheableTemperature
        : 0.3
  }
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : value
}

function normalizeScalarValue(key, value) {
  const normalized = normalizeString(value)
  if (NUMERIC_REQUEST_FIELDS.has(key)) {
    const numericValue = getNumericValue(normalized)
    if (numericValue !== null) {
      return numericValue
    }
  }
  return normalized
}

function normalizeValue(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, parentKey))
  }

  if (!value || typeof value !== 'object') {
    return normalizeScalarValue(parentKey, value)
  }

  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    if (OMITTED_REQUEST_FIELDS.has(key)) {
      continue
    }

    const normalizedValue = normalizeValue(value[key], key)
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue
    }
  }

  return normalized
}

function normalizeHeaders(headers = {}) {
  const normalized = {}
  for (const headerName of REQUEST_HEADER_WHITELIST) {
    const value = headers[headerName] ?? headers[headerName.toLowerCase()]
    if (value !== undefined && value !== null && value !== '') {
      normalized[headerName] = normalizeString(Array.isArray(value) ? value[0] : value)
    }
  }
  return normalized
}

function pickReplayHeaders(headers = {}) {
  const normalized = {}
  for (const headerName of RESPONSE_HEADER_WHITELIST) {
    const value = headers[headerName] ?? headers[headerName.toLowerCase()]
    if (value !== undefined && value !== null && value !== '') {
      normalized[headerName] = Array.isArray(value) ? value[0] : value
    }
  }
  return normalized
}

function hasDynamicFields(requestBody = {}) {
  return DYNAMIC_REQUEST_FIELDS.some((field) => {
    const value = requestBody[field]
    if (Array.isArray(value)) {
      return value.length > 0
    }
    return value !== undefined && value !== null && value !== false
  })
}

function getNumericValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeEndpointSegment(endpoint = 'responses') {
  return String(endpoint).replace(/\//g, '__')
}

function buildSignature(context, resolvedModel) {
  const normalizedBody = normalizeValue({
    ...(context.requestBody || {}),
    ...(resolvedModel ? { model: resolvedModel } : {})
  })

  return {
    provider: context.provider,
    endpoint: context.endpoint,
    headers: normalizeHeaders(context.requestHeaders),
    body: normalizedBody
  }
}

function createHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function createLockValue() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return crypto.randomBytes(16).toString('hex')
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function incrementMetric(name) {
  if (typeof redis.incrementOpenAIL1CacheMetric !== 'function') {
    return
  }
  await redis.incrementOpenAIL1CacheMetric(name)
}

/**
 * Builds the normalized cache plan for a request.
 *
 * @param {Object} context - Request cache context.
 * @returns {Object} Cache plan or bypass reason.
 */
function buildCachePlan(context = {}) {
  const settings = getSettings()

  if (!settings.enabled) {
    return { cacheable: false, reason: 'cache_disabled' }
  }

  if (!context.tenantId) {
    return { cacheable: false, reason: 'missing_tenant' }
  }

  if (context.isStream || context.requestBody?.stream) {
    return { cacheable: false, reason: 'stream_request' }
  }

  if (!context.requestBody || typeof context.requestBody !== 'object') {
    return { cacheable: false, reason: 'invalid_request_body' }
  }

  if (hasDynamicFields(context.requestBody)) {
    return { cacheable: false, reason: 'dynamic_tools' }
  }

  const endpoint = context.endpoint || 'responses'
  const temperature =
    endpoint === 'embeddings' ? null : getNumericValue(context.requestBody.temperature)
  if (temperature !== null && temperature > settings.maxCacheableTemperature) {
    return { cacheable: false, reason: 'temperature_too_high' }
  }

  const resolvedModel = context.resolvedModel || context.requestBody.model || null
  const signature = buildSignature(
    {
      ...context,
      endpoint
    },
    resolvedModel
  )
  const hash = createHash(signature)
  const endpointSegment = normalizeEndpointSegment(endpoint)
  const provider = context.provider || 'openai'

  return {
    cacheable: true,
    provider,
    endpoint,
    ttlSeconds:
      endpoint === 'embeddings' ? settings.embeddingsTtlSeconds : settings.defaultTtlSeconds,
    lockTtlMs: settings.lockTtlSeconds * 1000,
    waitTimeoutMs: settings.waitTimeoutMs,
    waitPollMs: settings.waitPollMs,
    cacheKey: `cache:openai:l1:${CACHE_VERSION}:${context.tenantId}:${provider}:${endpointSegment}:${hash}`,
    lockKey: `lock:openai:l1:${CACHE_VERSION}:${context.tenantId}:${provider}:${endpointSegment}:${hash}`,
    signature
  }
}

async function waitForFill(plan) {
  const deadline = Date.now() + plan.waitTimeoutMs

  while (Date.now() < deadline) {
    await sleep(plan.waitPollMs)
    const entry = await redis.getOpenAIL1CacheEntry(plan.cacheKey)
    if (entry) {
      return entry
    }
  }

  return null
}

/**
 * Resolves whether a request should hit cache, wait, or go upstream.
 *
 * @param {Object} context - Request cache context.
 * @returns {Promise<Object>} Cache hit, miss, or bypass decision.
 */
async function beginRequest(context = {}) {
  const plan = buildCachePlan(context)
  if (!plan.cacheable) {
    await incrementMetric('cache_bypass')
    return { kind: 'bypass', reason: plan.reason }
  }

  const existingEntry = await redis.getOpenAIL1CacheEntry(plan.cacheKey)
  if (existingEntry) {
    await incrementMetric('cache_hit_exact')
    return { kind: 'hit', entry: existingEntry, cacheKey: plan.cacheKey }
  }

  const lockValue = createLockValue()
  const lockAcquired = await redis.acquireOpenAIL1CacheLock(plan.lockKey, lockValue, plan.lockTtlMs)
  if (!lockAcquired) {
    const waitedEntry = await waitForFill(plan)
    if (waitedEntry) {
      await incrementMetric('cache_hit_exact')
      return { kind: 'hit', entry: waitedEntry, cacheKey: plan.cacheKey, waited: true }
    }
  }

  await incrementMetric('cache_miss')
  return {
    kind: 'miss',
    ...plan,
    lockAcquired,
    lockValue
  }
}

/**
 * Stores a successful non-stream response in Redis.
 *
 * @param {Object} decision - Cache decision from beginRequest().
 * @param {Object} responseContext - Response payload to cache.
 * @returns {Promise<Object>} Store result.
 */
async function storeResponse(decision, responseContext = {}) {
  if (!decision || decision.kind !== 'miss') {
    return { stored: false }
  }

  if (
    !Number.isInteger(responseContext.statusCode) ||
    responseContext.statusCode < 200 ||
    responseContext.statusCode >= 300 ||
    !responseContext.body ||
    typeof responseContext.body !== 'object'
  ) {
    return { stored: false }
  }

  await redis.setOpenAIL1CacheEntry(
    decision.cacheKey,
    {
      statusCode: responseContext.statusCode,
      body: responseContext.body,
      headers: pickReplayHeaders(responseContext.headers),
      actualModel: responseContext.actualModel || null,
      usage: responseContext.usage || null,
      meta: {
        cacheVersion: CACHE_VERSION,
        createdAt: new Date().toISOString()
      }
    },
    decision.ttlSeconds
  )
  await incrementMetric('cache_write')

  return { stored: true }
}

/**
 * Releases the in-flight cache reservation when owned by the caller.
 *
 * @param {Object|null} decision - Cache decision from beginRequest().
 * @returns {Promise<void>}
 */
async function finalizeRequest(decision) {
  if (!decision?.lockAcquired || !decision.lockKey || !decision.lockValue) {
    return
  }

  await redis.releaseOpenAIL1CacheLock(decision.lockKey, decision.lockValue)
}

/**
 * Replays a cached response through an Express response object.
 *
 * @param {Object} res - Express response.
 * @param {Object} entry - Cached response entry.
 * @returns {Object} Express response.
 */
function replayCachedResponse(res, entry = {}) {
  for (const [headerName, headerValue] of Object.entries(entry.headers || {})) {
    res.setHeader(headerName, headerValue)
  }

  return res.status(entry.statusCode || 200).json(entry.body)
}

module.exports = {
  buildCachePlan,
  beginRequest,
  storeResponse,
  finalizeRequest,
  replayCachedResponse
}
