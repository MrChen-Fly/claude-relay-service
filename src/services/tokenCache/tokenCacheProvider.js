const crypto = require('crypto')

function normalizeString(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  return trimmed || ''
}

function firstNonEmptyString(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate)
    if (normalized) {
      return normalized
    }
  }

  return ''
}

/**
 * Extracts the normalized prompt cache key from one or more payload objects.
 */
function extractPromptCacheKey(...payloads) {
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') {
      continue
    }

    const promptCacheKey = firstNonEmptyString([payload.prompt_cache_key, payload.promptCacheKey])
    if (promptCacheKey) {
      return promptCacheKey
    }
  }

  return ''
}

/**
 * Extracts the most stable cache session key from headers and request payloads.
 */
function extractStableTokenCacheSessionKey(req = null, ...payloads) {
  const headerCandidates = [req?.headers?.session_id, req?.headers?.['x-session-id']]

  const sessionCandidates = []
  const promptCacheCandidates = []
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') {
      continue
    }

    sessionCandidates.push(
      payload.session_id,
      payload.sessionId,
      payload.conversation_id,
      payload.conversationId
    )
    promptCacheCandidates.push(payload.prompt_cache_key, payload.promptCacheKey)
  }

  return firstNonEmptyString([...headerCandidates, ...sessionCandidates, ...promptCacheCandidates])
}

function extractHeaderSessionId(req = null) {
  return firstNonEmptyString([req?.headers?.session_id, req?.headers?.['x-session-id']])
}

function extractBodySessionId(...payloads) {
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') {
      continue
    }

    const sessionId = firstNonEmptyString([payload.session_id, payload.sessionId])
    if (sessionId) {
      return sessionId
    }
  }

  return ''
}

function extractConversationId(...payloads) {
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') {
      continue
    }

    const conversationId = firstNonEmptyString([payload.conversation_id, payload.conversationId])
    if (conversationId) {
      return conversationId
    }
  }

  return ''
}

/**
 * Builds a normalized relay-facing token cache context for lookup/store hooks.
 */
function buildTokenCacheRequestContext({
  req = null,
  attempt = null,
  account = null,
  accountType = 'openai-responses',
  requestedModel = null,
  clientStream = undefined
} = {}) {
  const originalRequestBody = req?.body && typeof req.body === 'object' ? req.body : null
  const upstreamRequestBody =
    attempt?.body && typeof attempt.body === 'object' ? attempt.body : null
  const requestBody = originalRequestBody || upstreamRequestBody

  const promptCacheKey = extractPromptCacheKey(requestBody, req?.body)
  const headerSessionId = extractHeaderSessionId(req)
  const bodySessionId = extractBodySessionId(requestBody, req?.body)
  const sessionKey = extractStableTokenCacheSessionKey(req, requestBody, req?.body)
  const conversationId = extractConversationId(requestBody, req?.body)
  const sessionHash = sessionKey
    ? crypto.createHash('sha256').update(sessionKey).digest('hex')
    : null
  const isStream = clientStream !== undefined ? Boolean(clientStream) : requestBody?.stream === true

  return {
    accountId: account?.id || null,
    accountName: account?.name || null,
    accountType,
    endpointPath: attempt?.path || req?.path || req?.originalUrl || '',
    requestedModel: requestedModel || attempt?.requestedModel || requestBody?.model || null,
    promptCacheKey,
    headerSessionId,
    bodySessionId,
    sessionKey,
    sessionHash,
    conversationId,
    isStream,
    requestBody,
    originalRequestBody,
    upstreamRequestBody
  }
}

/**
 * Base provider contract for pluggable token cache implementations.
 */
class TokenCacheProvider {
  getName() {
    return 'custom'
  }

  async lookup(_context) {
    return { hit: false }
  }

  async store(_context, _response) {
    return { stored: false }
  }
}

/**
 * Default no-op provider so the relay can expose stable cache hooks first.
 */
class NoopTokenCacheProvider extends TokenCacheProvider {
  getName() {
    return 'noop'
  }
}

module.exports = {
  TokenCacheProvider,
  NoopTokenCacheProvider,
  buildTokenCacheRequestContext,
  extractHeaderSessionId,
  extractBodySessionId,
  extractPromptCacheKey,
  extractStableTokenCacheSessionKey
}
