const logger = require('../../utils/logger')
const { buildCacheBypassSummary } = require('./openaiCacheCanonicalizer')

const BYPASS_LOG_WINDOW_MS = 10 * 60 * 1000
const bypassLogTimestamps = new Map()

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

function shouldEmitLog(logKey) {
  const now = Date.now()
  const lastLoggedAt = bypassLogTimestamps.get(logKey) || 0
  if (now - lastLoggedAt < BYPASS_LOG_WINDOW_MS) {
    return false
  }

  bypassLogTimestamps.set(logKey, now)
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
  if (!shouldEmitLog(logKey)) {
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

function resetBypassLogDiagnosticsForTests() {
  bypassLogTimestamps.clear()
}

module.exports = {
  logCacheBypassDetails,
  resetBypassLogDiagnosticsForTests
}
