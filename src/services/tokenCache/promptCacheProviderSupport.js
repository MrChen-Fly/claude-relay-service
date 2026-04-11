function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractContentText(content) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (!Array.isArray(content)) {
    if (!content || typeof content !== 'object') {
      return ''
    }

    return normalizeString(content.text || content.output_text || content.input_text)
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item
      }

      if (!item || typeof item !== 'object') {
        return ''
      }

      return item.text || item.output_text || item.input_text || ''
    })
    .join(' ')
    .trim()
}

function buildHitResult(providerName, entry, layer, score = undefined) {
  const headers = {
    'x-token-cache': 'HIT',
    'x-token-cache-layer': layer,
    'x-token-cache-provider': providerName
  }

  if (score !== undefined && score !== null) {
    headers['x-token-cache-score'] = String(score || 0)
  }

  return {
    hit: true,
    statusCode: entry.statusCode || 200,
    body: entry.body,
    headers
  }
}

function buildHitMetrics(layer) {
  if (layer === 'exact') {
    return {
      hits: 1,
      exactHits: 1
    }
  }

  if (layer === 'tool_result') {
    return {
      hits: 1,
      toolResultHits: 1
    }
  }

  const semanticMetrics = {
    hits: 1,
    semanticHits: 1
  }

  if (layer === 'semantic_verified') {
    semanticMetrics.semanticVerifiedHits = 1
  }

  return semanticMetrics
}

function buildDiagnosticEvent(providerName, context, evaluation, extra = {}) {
  const diagnostics = evaluation?.diagnostics || {}

  return {
    timestamp: extra.timestamp || Date.now(),
    eventType: extra.eventType || 'unknown',
    layer: extra.layer || '',
    reason: extra.reason || '',
    provider: providerName,
    accountId: context?.accountId || '',
    accountName: context?.accountName || '',
    requestedModel: context?.requestedModel || context?.requestBody?.model || '',
    promptCacheKey: context?.promptCacheKey || '',
    sessionHash: context?.sessionHash || '',
    conversationId: context?.conversationId || '',
    cacheKey: evaluation?.cacheKey || '',
    scopeKey: evaluation?.scopeKey || '',
    cacheStrategy: evaluation?.cacheStrategy || '',
    semanticEligible: evaluation?.semanticEligible !== false,
    toolCandidateCount: Number(
      evaluation?.toolCandidateCount ||
        (Array.isArray(evaluation?.toolResultCandidates)
          ? evaluation.toolResultCandidates.length
          : 0)
    ),
    messageCount: Number(diagnostics.messageCount || 0),
    promptLength: Number(diagnostics.promptLength || 0),
    transcriptLength: Number(diagnostics.transcriptLength || 0),
    systemLength: Number(diagnostics.systemLength || 0),
    promptHash: diagnostics.promptHash || '',
    transcriptHash: diagnostics.transcriptHash || '',
    systemHash: diagnostics.systemHash || '',
    score: extra.score,
    statusCode: extra.statusCode
  }
}

function resolveSemanticHitLayer(cacheKey, semanticHit = {}) {
  if (semanticHit.layer === 'semantic_verified') {
    return 'semantic_verified'
  }

  if (semanticHit.cacheKey === cacheKey) {
    return 'exact'
  }

  return semanticHit.layer || 'semantic'
}

function isResponsesPayload(context = {}, payload = {}) {
  const normalizedPath = normalizeString(context?.endpointPath).toLowerCase()
  return (
    normalizedPath.includes('/responses') ||
    payload.object === 'response' ||
    Array.isArray(payload.output)
  )
}

function isActionOutputItem(item = {}) {
  const type = normalizeString(item.type).toLowerCase()
  return (
    type === 'function_call' ||
    type === 'tool_call' ||
    type === 'computer_call' ||
    type === 'approval_request' ||
    (type.endsWith('_call') && type !== 'message')
  )
}

function isTerminalResponsesPayload(payload = {}) {
  const status = normalizeString(payload.status).toLowerCase()
  if (status && status !== 'completed') {
    return false
  }

  const output = Array.isArray(payload.output) ? payload.output : null
  if (output && output.length > 0) {
    let hasTerminalAssistantMessage = false

    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const itemStatus = normalizeString(item.status).toLowerCase()
      if (itemStatus && itemStatus !== 'completed') {
        return false
      }

      if (
        (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) ||
        item.function_call ||
        isActionOutputItem(item)
      ) {
        return false
      }

      if (item.type === 'message' && normalizeString(item.role).toLowerCase() === 'assistant') {
        hasTerminalAssistantMessage =
          hasTerminalAssistantMessage || Boolean(extractContentText(item.content))
      }
    }

    return hasTerminalAssistantMessage
  }

  return Boolean(extractContentText(payload.output_text))
}

function isTerminalChatPayload(payload = {}) {
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    return false
  }

  let hasTerminalAssistantMessage = false

  for (const choice of payload.choices) {
    const finishReason = normalizeString(choice?.finish_reason).toLowerCase()
    const message = choice?.message

    if (
      finishReason === 'tool_calls' ||
      (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) ||
      message?.function_call
    ) {
      return false
    }

    if (normalizeString(message?.role).toLowerCase() === 'assistant') {
      hasTerminalAssistantMessage =
        hasTerminalAssistantMessage || Boolean(extractContentText(message.content))
    }
  }

  return hasTerminalAssistantMessage
}

function getReplayStoreSkipReason(context = {}, response = {}) {
  const payload = response?.body
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  if (isResponsesPayload(context, payload)) {
    return isTerminalResponsesPayload(payload) ? '' : 'non_terminal_response'
  }

  if (Array.isArray(payload.choices)) {
    return isTerminalChatPayload(payload) ? '' : 'non_terminal_response'
  }

  return ''
}

module.exports = {
  buildDiagnosticEvent,
  buildHitMetrics,
  buildHitResult,
  getReplayStoreSkipReason,
  resolveSemanticHitLayer
}
