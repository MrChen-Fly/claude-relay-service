const logger = require('../../utils/logger')
const { buildCacheBypassSummary } = require('./openaiCacheCanonicalizer')

const BYPASS_LOG_WINDOW_MS = 10 * 60 * 1000
const bypassLogTimestamps = new Map()
const storeSkipLogTimestamps = new Map()

function shouldLogReason(reason = '') {
  if (!reason) {
    return false
  }

  return (
    reason === 'dynamic_request' ||
    reason === 'dynamic_tools' ||
    reason === 'structured_output_request' ||
    reason.startsWith('tool_') ||
    reason.startsWith('request_') ||
    reason.startsWith('unsupported_')
  )
}

function buildLogKey(layer, reason, endpoint, shapeHash) {
  return `${layer}:${reason}:${endpoint || 'responses'}:${shapeHash || 'unknown'}`
}

function shouldEmitLog(logKey, timestamps) {
  const now = Date.now()
  const lastLoggedAt = timestamps.get(logKey) || 0
  if (now - lastLoggedAt < BYPASS_LOG_WINDOW_MS) {
    return false
  }

  timestamps.set(logKey, now)
  return true
}

function logCacheBypassDetails({ layer, reason, context = {}, semanticSafeOnly = false }) {
  if (!shouldLogReason(reason)) {
    return
  }

  const requestBody =
    context.requestBody && typeof context.requestBody === 'object' ? context.requestBody : {}
  const summary = buildCacheBypassSummary(requestBody, { semanticSafeOnly })
  const logKey = buildLogKey(layer, reason, context.endpoint, summary.shapeHash)
  if (!shouldEmitLog(logKey, bypassLogTimestamps)) {
    return
  }

  logger.info(`OpenAI ${String(layer || '').toUpperCase()} cache bypass detail`, {
    type: 'openai_cache_bypass_detail',
    layer,
    reason,
    endpoint: context.endpoint || 'responses',
    provider: context.provider || null,
    model: context.resolvedModel || requestBody.model || null,
    summary
  })
}

function buildResponseStoreSkipSummary(responseBody = {}) {
  const outputItems = Array.isArray(responseBody.output) ? responseBody.output : []
  const outputTypes = Array.from(
    new Set(
      outputItems
        .map((item) => (typeof item?.type === 'string' ? item.type : 'unknown'))
        .filter(Boolean)
    )
  ).sort()

  return {
    outputCount: outputItems.length,
    outputTypes,
    hasToolCalls: outputTypes.some((type) => type.endsWith('_call')),
    hasOutputText: outputTypes.some((type) => type === 'output_text' || type === 'message')
  }
}

function logCacheStoreSkipDetails({ layer, reason, context = {}, responseBody = {} }) {
  if (!reason) {
    return
  }

  const requestBody =
    context.requestBody && typeof context.requestBody === 'object' ? context.requestBody : {}
  const requestSummary = buildCacheBypassSummary(requestBody, { semanticSafeOnly: true })
  const responseSummary = buildResponseStoreSkipSummary(responseBody)
  const logKey = buildLogKey(layer, reason, context.endpoint, requestSummary.shapeHash)
  if (!shouldEmitLog(logKey, storeSkipLogTimestamps)) {
    return
  }

  logger.info(`OpenAI ${String(layer || '').toUpperCase()} cache store skip detail`, {
    type: 'openai_cache_store_skip_detail',
    layer,
    reason,
    endpoint: context.endpoint || 'responses',
    provider: context.provider || null,
    model: context.resolvedModel || requestBody.model || null,
    requestSummary,
    responseSummary
  })
}

function resetBypassLogDiagnosticsForTests() {
  bypassLogTimestamps.clear()
  storeSkipLogTimestamps.clear()
}

module.exports = {
  logCacheBypassDetails,
  logCacheStoreSkipDetails,
  resetBypassLogDiagnosticsForTests
}
