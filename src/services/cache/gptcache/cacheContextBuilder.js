const crypto = require('crypto')

function normalizeIdentifier(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function createHash(input) {
  const normalized = typeof input === 'string' ? input : JSON.stringify(input)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function resolveContextScope(requestHeaders = {}, requestBody = {}) {
  const sessionId = normalizeIdentifier(
    requestHeaders?.session_id ||
      requestHeaders?.['session_id'] ||
      requestBody?.session_id ||
      requestBody?.sessionId
  )
  if (sessionId) {
    return {
      scopeType: 'session',
      scopeId: sessionId,
      scopeHash: createHash(sessionId)
    }
  }

  const conversationId = normalizeIdentifier(
    requestHeaders?.conversation_id ||
      requestHeaders?.['conversation_id'] ||
      requestBody?.conversation_id ||
      requestBody?.conversationId
  )
  if (conversationId) {
    return {
      scopeType: 'conversation',
      scopeId: conversationId,
      scopeHash: createHash(conversationId)
    }
  }

  return {
    scopeType: 'none',
    scopeId: null,
    scopeHash: null
  }
}

function buildContextFingerprint(scope = {}, items = []) {
  const recentRequestHashes = items
    .slice(-2)
    .map((item) => item?.requestHash)
    .filter(Boolean)

  if (!scope.scopeHash && recentRequestHashes.length === 0) {
    return null
  }

  return createHash({
    scopeType: scope.scopeType || 'none',
    scopeHash: scope.scopeHash || null,
    recentRequestHashes
  })
}

function buildCacheContext(context = {}, bufferSnapshot = null) {
  const scope = resolveContextScope(context.requestHeaders, context.requestBody)
  const items = Array.isArray(bufferSnapshot?.items) ? bufferSnapshot.items : []

  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    scopeHash: scope.scopeHash,
    hasScope: Boolean(scope.scopeHash),
    items,
    contextFingerprint: buildContextFingerprint(scope, items)
  }
}

module.exports = {
  buildCacheContext,
  buildContextFingerprint,
  createHash,
  resolveContextScope
}
