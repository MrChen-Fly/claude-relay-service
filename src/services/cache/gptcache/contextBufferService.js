const config = require('../../../../config/config')
const redis = require('../../../models/redis')
const { createHash, resolveContextScope } = require('./cacheContextBuilder')

const CONTEXT_BUFFER_VERSION = 'v1'

function getSettings() {
  return {
    enabled: config.openaiCache?.l2?.contextBuffer?.enabled !== false,
    ttlSeconds: config.openaiCache?.l2?.contextBuffer?.ttlSeconds || 604800,
    maxItems: config.openaiCache?.l2?.contextBuffer?.maxItems || 6
  }
}

function buildBufferKey(tenantId, scopeHash) {
  return `cache:openai:l2:ctx:${CONTEXT_BUFFER_VERSION}:${tenantId}:${scopeHash}`
}

async function incrementMetric(name) {
  if (typeof redis.incrementOpenAIL2CacheMetric !== 'function') {
    return
  }

  await redis.incrementOpenAIL2CacheMetric(name)
}

async function getSnapshot(context = {}) {
  const settings = getSettings()
  if (!settings.enabled) {
    return { enabled: false, reason: 'context_buffer_disabled', items: [] }
  }

  if (!context.tenantId) {
    return { enabled: false, reason: 'missing_tenant', items: [] }
  }

  const scope = resolveContextScope(context.requestHeaders, context.requestBody)
  if (!scope.scopeHash) {
    return {
      enabled: false,
      reason: 'missing_context_scope',
      scopeType: scope.scopeType,
      items: []
    }
  }

  const bufferKey = buildBufferKey(context.tenantId, scope.scopeHash)
  const items = await redis.getOpenAIL2ContextBuffer(bufferKey, settings.maxItems)
  await incrementMetric(items.length > 0 ? 'context_buffer_hit' : 'context_buffer_miss')

  return {
    enabled: true,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    scopeHash: scope.scopeHash,
    bufferKey,
    ttlSeconds: settings.ttlSeconds,
    maxItems: settings.maxItems,
    items
  }
}

function createContextEntry(interaction = {}) {
  const requestText =
    typeof interaction.requestText === 'string' ? interaction.requestText.trim() : ''
  const responseText =
    typeof interaction.responseText === 'string' ? interaction.responseText.trim() : ''

  if (!requestText || !responseText) {
    return null
  }

  return {
    requestText,
    responseText,
    requestHash: createHash(requestText),
    model: interaction.model || null,
    cacheSource: interaction.cacheSource || 'upstream',
    createdAt: new Date().toISOString()
  }
}

async function rememberInteraction(snapshot, interaction = {}) {
  if (!snapshot?.enabled || !snapshot.bufferKey) {
    return { stored: false, reason: 'buffer_disabled' }
  }

  const entry = createContextEntry(interaction)
  if (!entry) {
    return { stored: false, reason: 'missing_text' }
  }

  await redis.appendOpenAIL2ContextBuffer(
    snapshot.bufferKey,
    entry,
    snapshot.ttlSeconds || getSettings().ttlSeconds,
    snapshot.maxItems || getSettings().maxItems
  )
  await incrementMetric('context_buffer_write')

  return { stored: true, entry }
}

module.exports = {
  buildBufferKey,
  createContextEntry,
  getSettings,
  getSnapshot,
  rememberInteraction
}
