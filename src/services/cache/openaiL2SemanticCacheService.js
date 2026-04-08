const axios = require('axios')
const crypto = require('crypto')
const config = require('../../../config/config')
const redis = require('../../models/redis')
const logger = require('../../utils/logger')
const ProxyHelper = require('../../utils/proxyHelper')
const { filterForOpenAI } = require('../../utils/headerFilter')
const { rankCandidates, cosineSimilarity } = require('./gptcache/similarityEvaluator')
const {
  normalizeText,
  buildCanonicalPrompt,
  buildToolProfile,
  hasAlwaysDynamicFields,
  isStructuredOutputRequest
} = require('./openaiCacheCanonicalizer')

const CACHE_VERSION = 'v1'
const RESPONSE_HEADER_WHITELIST = [
  'x-request-id',
  'openai-version',
  'openai-processing-ms',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens'
]

function getSettings() {
  return {
    enabled: config.openaiCache?.l2?.enabled !== false,
    embeddingBaseUrl: normalizeBaseApi(config.openaiCache?.l2?.embeddingBaseUrl || ''),
    embeddingApiKey: config.openaiCache?.l2?.embeddingApiKey || '',
    embeddingModel: config.openaiCache?.l2?.embeddingModel || 'text-embedding-3-small',
    similarityThreshold:
      typeof config.openaiCache?.l2?.similarityThreshold === 'number'
        ? config.openaiCache.l2.similarityThreshold
        : 0.95,
    entryTtlSeconds: config.openaiCache?.l2?.entryTtlSeconds || 604800,
    embeddingTtlSeconds: config.openaiCache?.l2?.embeddingTtlSeconds || 2592000,
    maxCandidates: config.openaiCache?.l2?.maxCandidates || 20,
    maxIndexedEntries: config.openaiCache?.l2?.maxIndexedEntries || 200,
    maxTextLength: config.openaiCache?.l2?.maxTextLength || 12000,
    rankAcceptanceThreshold:
      typeof config.openaiCache?.l2?.rankAcceptanceThreshold === 'number'
        ? config.openaiCache.l2.rankAcceptanceThreshold
        : 0.9,
    maxCacheableTemperature:
      typeof config.openaiCache?.l2?.maxCacheableTemperature === 'number'
        ? config.openaiCache.l2.maxCacheableTemperature
        : 0.3
  }
}

function getNumericValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Normalizes an embedding API base URL by trimming whitespace and trailing slashes.
 *
 * @param {string} baseApi - Raw base URL from config or account.
 * @returns {string} Normalized base URL.
 */
function normalizeBaseApi(baseApi) {
  if (typeof baseApi !== 'string') {
    return ''
  }

  return baseApi.trim().replace(/\/+$/, '')
}

function createHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function createEntryId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return crypto.randomBytes(16).toString('hex')
}

function buildEmbeddingKey(textHash) {
  return `cache:openai:l2:embed:${CACHE_VERSION}:${textHash}`
}

function buildEntryKey(tenantId, entryId) {
  return `cache:openai:l2:entry:${CACHE_VERSION}:${tenantId}:${entryId}`
}

function buildIndexKey(tenantId) {
  return `cache:openai:l2:index:${CACHE_VERSION}:${tenantId}`
}

/**
 * Resolves the embedding endpoint configuration for semantic cache requests.
 *
 * @param {Object} context - Request cache context.
 * @param {Object} settings - L2 cache settings.
 * @returns {Object} Effective embedding target configuration.
 */
function resolveEmbeddingTarget(context = {}, settings = {}) {
  const configuredBaseApi = normalizeBaseApi(settings.embeddingBaseUrl)
  const accountBaseApi = normalizeBaseApi(context.fullAccount?.baseApi || '')
  const userAgent =
    context.fullAccount?.userAgent || context.requestHeaders?.['user-agent'] || undefined

  if (configuredBaseApi) {
    return {
      source: 'configured',
      baseApi: configuredBaseApi,
      apiKey: settings.embeddingApiKey || '',
      proxy: context.fullAccount?.proxy,
      userAgent
    }
  }

  return {
    source: 'account',
    baseApi: accountBaseApi,
    apiKey: context.fullAccount?.apiKey || '',
    proxy: context.fullAccount?.proxy,
    userAgent
  }
}

/**
 * Builds a stable identity string for an embedding provider configuration.
 *
 * @param {Object} target - Effective embedding target configuration.
 * @param {string} embeddingModel - Embedding model name.
 * @returns {string} Stable source fingerprint payload.
 */
function buildEmbeddingSource(target = {}, embeddingModel = '') {
  return createHash({
    source: target.source || 'account',
    baseApi: normalizeBaseApi(target.baseApi || '').toLowerCase(),
    embeddingModel
  })
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

function extractSemanticText(requestBody = {}) {
  const result = buildCanonicalPrompt(requestBody, {
    semanticMode: true
  })

  if (!result.supported) {
    return result
  }

  return {
    supported: true,
    text: result.text,
    focalText: result.focalText || result.text
  }
}

function hasResponseToolCalls(responseBody = {}) {
  const outputItems = Array.isArray(responseBody.output) ? responseBody.output : []

  return outputItems.some(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.type === 'string' &&
      item.type.endsWith('_call')
  )
}

function extractResponseText(responseBody = {}) {
  const outputItems = Array.isArray(responseBody.output) ? responseBody.output : []
  const parts = []

  for (const item of outputItems) {
    if (!item || typeof item !== 'object') {
      continue
    }

    if (typeof item.text === 'string') {
      const normalized = normalizeText(item.text)
      if (normalized) {
        parts.push(normalized)
      }
      continue
    }

    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue
      }
      const value =
        typeof part.output_text === 'string'
          ? part.output_text
          : typeof part.text === 'string'
            ? part.text
            : ''
      const normalized = normalizeText(value)
      if (normalized) {
        parts.push(normalized)
      }
    }
  }

  return parts.join(' ').trim()
}

function normalizeTargetPath(baseApi, targetPath) {
  if (baseApi.endsWith('/v1') && targetPath.startsWith('/v1/')) {
    return targetPath.slice(3)
  }
  return targetPath
}

function buildEmbeddingHeaders(requestHeaders, target) {
  const headers = {
    ...filterForOpenAI(requestHeaders || {}),
    'Content-Type': 'application/json'
  }

  if (target.apiKey) {
    headers.Authorization = `Bearer ${target.apiKey}`
  }

  if (target.userAgent) {
    headers['User-Agent'] = target.userAgent
  } else if (requestHeaders?.['user-agent']) {
    headers['User-Agent'] = requestHeaders['user-agent']
  }

  return headers
}

async function incrementMetric(name) {
  if (typeof redis.incrementOpenAIL2CacheMetric !== 'function') {
    return
  }
  await redis.incrementOpenAIL2CacheMetric(name)
}

async function incrementBypassMetrics(reason) {
  await incrementMetric('cache_bypass')

  if (typeof redis.incrementOpenAIL2CacheBypassReason !== 'function' || !reason) {
    return
  }

  await redis.incrementOpenAIL2CacheBypassReason(reason)
}

/**
 * Builds the normalized L2 cache plan for a request.
 *
 * @param {Object} context - Request cache context.
 * @returns {Object} Cache plan or bypass reason.
 */
function buildCachePlan(context = {}) {
  const settings = getSettings()
  const embeddingTarget = resolveEmbeddingTarget(context, settings)
  const toolProfile = buildToolProfile(context.requestBody, {
    semanticSafeOnly: true
  })

  if (!settings.enabled) {
    return { cacheable: false, reason: 'cache_disabled' }
  }

  if (context.endpoint !== 'responses') {
    return { cacheable: false, reason: 'unsupported_endpoint' }
  }

  if (!context.tenantId) {
    return { cacheable: false, reason: 'missing_tenant' }
  }

  if (!embeddingTarget.baseApi) {
    return { cacheable: false, reason: 'missing_embedding_base_api' }
  }

  if (embeddingTarget.source === 'account' && !embeddingTarget.apiKey) {
    return { cacheable: false, reason: 'missing_account_credentials' }
  }

  if ((context.isStream || context.requestBody?.stream) && !context.allowStreamLookup) {
    return { cacheable: false, reason: 'stream_request' }
  }

  if (!context.requestBody || typeof context.requestBody !== 'object') {
    return { cacheable: false, reason: 'invalid_request_body' }
  }

  if (hasAlwaysDynamicFields(context.requestBody)) {
    return { cacheable: false, reason: 'dynamic_request' }
  }

  if (!toolProfile.supported) {
    return { cacheable: false, reason: toolProfile.reason || 'dynamic_request' }
  }

  if (isStructuredOutputRequest(context.requestBody)) {
    return { cacheable: false, reason: 'structured_output_request' }
  }

  const temperature = getNumericValue(context.requestBody.temperature)
  if (temperature !== null && temperature > settings.maxCacheableTemperature) {
    return { cacheable: false, reason: 'temperature_too_high' }
  }

  const model = context.resolvedModel || context.requestBody.model || null
  if (!model) {
    return { cacheable: false, reason: 'missing_model' }
  }

  const semanticText = extractSemanticText(context.requestBody)
  if (!semanticText.supported) {
    return { cacheable: false, reason: semanticText.reason }
  }

  if (semanticText.text.length > settings.maxTextLength) {
    return { cacheable: false, reason: 'text_too_long' }
  }

  const embeddingSource = buildEmbeddingSource(embeddingTarget, settings.embeddingModel)
  const textHash = createHash({
    embeddingSource,
    text: semanticText.focalText
  })

  return {
    cacheable: true,
    tenantId: context.tenantId,
    endpoint: context.endpoint,
    model,
    provider: context.provider || 'openai-responses',
    embeddingSource,
    embeddingBaseUrl: embeddingTarget.baseApi,
    embeddingApiKey: embeddingTarget.apiKey,
    embeddingProxy: embeddingTarget.proxy,
    embeddingUserAgent: embeddingTarget.userAgent,
    embeddingModel: settings.embeddingModel,
    similarityThreshold: settings.similarityThreshold,
    entryTtlSeconds: settings.entryTtlSeconds,
    embeddingTtlSeconds: settings.embeddingTtlSeconds,
    maxCandidates: settings.maxCandidates,
    maxIndexedEntries: settings.maxIndexedEntries,
    rankAcceptanceThreshold: settings.rankAcceptanceThreshold,
    queryText: semanticText.focalText,
    requestText: semanticText.text,
    requestHasTools: toolProfile.hasTools,
    toolChoiceMode: toolProfile.choiceMode,
    parallelToolCalls: toolProfile.parallelToolCalls,
    toolSignature: toolProfile.hasTools ? createHash(toolProfile.tools) : null,
    textHash,
    embeddingKey: buildEmbeddingKey(textHash),
    indexKey: buildIndexKey(context.tenantId),
    contextFingerprint: context.cacheContext?.contextFingerprint || null
  }
}

function buildCaptureContext(context = {}) {
  const requestBody =
    context.requestBody && typeof context.requestBody === 'object'
      ? {
          ...context.requestBody,
          stream: false
        }
      : context.requestBody

  return {
    ...context,
    isStream: false,
    requestBody
  }
}

async function requestEmbedding(context, plan) {
  const targetPath = normalizeTargetPath(plan.embeddingBaseUrl || '', '/v1/embeddings')
  const requestOptions = {
    method: 'POST',
    url: `${plan.embeddingBaseUrl || ''}${targetPath}`,
    headers: buildEmbeddingHeaders(context.requestHeaders, {
      apiKey: plan.embeddingApiKey,
      userAgent: plan.embeddingUserAgent
    }),
    data: {
      model: plan.embeddingModel,
      input: plan.queryText
    },
    timeout: config.requestTimeout || 600000,
    validateStatus: () => true
  }

  if (plan.embeddingProxy) {
    const proxyAgent = ProxyHelper.createProxyAgent(plan.embeddingProxy)
    if (proxyAgent) {
      requestOptions.httpAgent = proxyAgent
      requestOptions.httpsAgent = proxyAgent
      requestOptions.proxy = false
    }
  }

  const response = await axios(requestOptions)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`embedding_request_failed:${response.status}`)
  }

  const embedding = response.data?.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('embedding_response_invalid')
  }

  return embedding
}

async function getOrCreateEmbedding(context, plan) {
  const cachedEmbedding = await redis.getOpenAIL2Embedding(plan.embeddingKey)
  if (cachedEmbedding?.vector?.length) {
    await incrementMetric('embedding_hit')
    return cachedEmbedding.vector
  }

  const vector = await requestEmbedding(context, plan)
  await redis.setOpenAIL2Embedding(
    plan.embeddingKey,
    {
      model: plan.embeddingModel,
      vector,
      meta: {
        cacheVersion: CACHE_VERSION,
        createdAt: new Date().toISOString()
      }
    },
    plan.embeddingTtlSeconds
  )
  await incrementMetric('embedding_miss')
  return vector
}

/**
 * Resolves whether a request should bypass, miss, or hit L2 cache.
 *
 * @param {Object} context - Request cache context.
 * @returns {Promise<Object>} Semantic cache decision.
 */
async function beginRequest(context = {}) {
  const plan = buildCachePlan(context)
  if (!plan.cacheable) {
    await incrementBypassMetrics(plan.reason)
    return { kind: 'bypass', reason: plan.reason }
  }

  let queryEmbedding
  try {
    queryEmbedding = await getOrCreateEmbedding(context, plan)
  } catch (error) {
    logger.warn('OpenAI L2 embedding generation failed, bypassing semantic cache', {
      tenantId: context.tenantId,
      endpoint: context.endpoint,
      model: plan.model,
      reason: error.message
    })
    await incrementBypassMetrics('embedding_request_failed')
    return { kind: 'bypass', reason: 'embedding_request_failed' }
  }

  const candidateKeys = await redis.getOpenAIL2CandidateKeys(plan.indexKey, plan.maxCandidates)
  if (!candidateKeys.length) {
    await incrementMetric('cache_miss')
    return { kind: 'miss', ...plan, queryEmbedding }
  }

  const entries = await redis.getOpenAIL2Entries(candidateKeys)
  const embeddingKeys = entries.map((entry) =>
    entry?.textHash ? buildEmbeddingKey(entry.textHash) : null
  )
  const embeddings = await redis.getOpenAIL2Embeddings(embeddingKeys.filter(Boolean))
  const embeddingMap = new Map()

  embeddingKeys.filter(Boolean).forEach((cacheKey, index) => {
    embeddingMap.set(cacheKey, embeddings[index] || null)
  })

  const candidates = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (
      !entry ||
      entry.model !== plan.model ||
      !entry.textHash ||
      entry.embeddingSource !== plan.embeddingSource ||
      (entry.toolSignature || null) !== (plan.toolSignature || null) ||
      (entry.toolChoiceMode || 'auto') !== (plan.toolChoiceMode || 'auto') ||
      (entry.parallelToolCalls ?? null) !== (plan.parallelToolCalls ?? null)
    ) {
      continue
    }

    const cachedEmbedding = embeddingMap.get(buildEmbeddingKey(entry.textHash))
    if (!cachedEmbedding?.vector?.length) {
      continue
    }

    candidates.push({
      entry,
      entryKey: candidateKeys[index],
      embedding: cachedEmbedding.vector
    })
  }

  const ranking = rankCandidates({
    plan,
    queryEmbedding,
    candidates
  })
  const bestCandidate = ranking.accepted

  if (!bestCandidate) {
    if (ranking.best?.similarity >= plan.similarityThreshold) {
      await incrementMetric('cache_reject_ranked')
    }

    await incrementMetric('cache_miss')
    return {
      kind: 'miss',
      ...plan,
      queryEmbedding,
      evaluation: ranking.best
        ? {
            similarity: ranking.best.similarity,
            score: ranking.best.score,
            factors: ranking.best.factors,
            hasContextConflict: ranking.best.hasContextConflict
          }
        : null
    }
  }

  await incrementMetric('cache_hit_semantic')
  return {
    kind: 'hit',
    ...plan,
    queryEmbedding,
    similarity: bestCandidate.similarity,
    score: bestCandidate.score,
    candidate: bestCandidate.entry,
    candidateKey: bestCandidate.entryKey,
    entry: bestCandidate.entry.cachedResponse || null,
    evaluation: bestCandidate.factors
  }
}

async function createCaptureDecision(context = {}) {
  const captureContext = buildCaptureContext(context)
  const plan = buildCachePlan(captureContext)
  if (!plan.cacheable) {
    return { kind: 'bypass', reason: plan.reason }
  }

  try {
    const queryEmbedding = await getOrCreateEmbedding(captureContext, plan)
    return {
      kind: 'miss',
      ...plan,
      queryEmbedding,
      captureOnly: true
    }
  } catch (error) {
    logger.warn('OpenAI L2 embedding generation failed during stream cache capture', {
      tenantId: context.tenantId,
      endpoint: context.endpoint,
      model: plan.model,
      reason: error.message
    })
    return { kind: 'bypass', reason: 'embedding_request_failed' }
  }
}

/**
 * Stores a successful semantic cache entry after upstream success.
 *
 * @param {Object} decision - Semantic cache decision from beginRequest().
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

  if (decision.requestHasTools && hasResponseToolCalls(responseContext.body)) {
    return { stored: false }
  }

  const entryId = createEntryId()
  const entryKey = buildEntryKey(decision.tenantId, entryId)
  const cachedResponse = {
    statusCode: responseContext.statusCode,
    body: responseContext.body,
    headers: pickReplayHeaders(responseContext.headers),
    actualModel: responseContext.actualModel || null,
    usage: responseContext.usage || null,
    meta: {
      cacheVersion: CACHE_VERSION,
      createdAt: new Date().toISOString()
    }
  }

  const entryPayload = {
    tenantId: decision.tenantId,
    provider: decision.provider,
    endpoint: decision.endpoint,
    model: decision.model,
    textHash: decision.textHash,
    embeddingSource: decision.embeddingSource,
    requestText: decision.requestText,
    requestFocalText: decision.queryText,
    responseText: extractResponseText(responseContext.body),
    embeddingModel: decision.embeddingModel,
    similarityThreshold: decision.similarityThreshold,
    rankAcceptanceThreshold: decision.rankAcceptanceThreshold,
    contextFingerprint: decision.contextFingerprint || null,
    toolSignature: decision.toolSignature || null,
    toolChoiceMode: decision.toolChoiceMode || 'auto',
    parallelToolCalls: decision.parallelToolCalls ?? null,
    cachedResponse,
    meta: {
      cacheVersion: CACHE_VERSION,
      createdAt: new Date().toISOString()
    }
  }

  if (Array.isArray(decision.queryEmbedding) && decision.queryEmbedding.length) {
    await redis.setOpenAIL2Embedding(
      decision.embeddingKey,
      {
        model: decision.embeddingModel,
        vector: decision.queryEmbedding,
        meta: {
          cacheVersion: CACHE_VERSION,
          createdAt: new Date().toISOString()
        }
      },
      decision.embeddingTtlSeconds
    )
  }

  await redis.setOpenAIL2Entry(entryKey, entryPayload, decision.entryTtlSeconds)
  await redis.addOpenAIL2IndexEntry(
    decision.indexKey,
    entryKey,
    Date.now(),
    decision.entryTtlSeconds,
    decision.maxIndexedEntries
  )
  await incrementMetric('cache_write')

  return { stored: true, entryKey }
}

module.exports = {
  buildCachePlan,
  beginRequest,
  createCaptureDecision,
  storeResponse,
  extractSemanticText,
  extractResponseText,
  cosineSimilarity
}
