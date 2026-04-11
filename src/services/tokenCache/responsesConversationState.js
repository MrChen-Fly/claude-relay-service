function firstNonEmptyString(candidates = []) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue
    }

    const normalized = candidate.trim()
    if (normalized) {
      return normalized
    }
  }

  return ''
}

function summarizeInlineTranscript(messages = []) {
  let userTurnCount = 0
  let hasAssistantOrToolMessages = false

  for (const message of messages) {
    if (!message || message.role === 'system') {
      continue
    }

    if (message.role === 'assistant' || message.role === 'tool') {
      hasAssistantOrToolMessages = true
    }

    if (message.role === 'user' && message.content) {
      userTurnCount += 1
    }
  }

  return {
    userTurnCount,
    hasAssistantOrToolMessages,
    hasInlineTranscript: hasAssistantOrToolMessages || userTurnCount > 1
  }
}

function classifyResponsesConversation(body = {}, messages = [], context = {}) {
  const previousResponseId = firstNonEmptyString([
    body.previous_response_id,
    body.previousResponseId
  ])
  const conversationId = firstNonEmptyString([
    context.conversationId,
    body.conversation_id,
    body.conversationId
  ])
  const headerSessionId = firstNonEmptyString([context.headerSessionId])
  const bodySessionId = firstNonEmptyString([
    context.bodySessionId,
    body.session_id,
    body.sessionId
  ])
  const inlineTranscript = summarizeInlineTranscript(messages)
  const hasOpaqueSessionAnchor = Boolean(headerSessionId || bodySessionId || conversationId)
  const hasTurnAnchor = Boolean(previousResponseId || inlineTranscript.hasInlineTranscript)
  const exactEligible = hasTurnAnchor
  const requestClass = previousResponseId
    ? 'stateful_previous_response'
    : inlineTranscript.hasInlineTranscript
      ? 'stateful_inline_transcript'
      : hasOpaqueSessionAnchor
        ? 'stateful_unanchored'
        : 'stateless_turn'

  return {
    exactEligible,
    bypassReason: !hasTurnAnchor && hasOpaqueSessionAnchor ? 'stateful_unanchored' : '',
    requestClass,
    stateAnchor: {
      previousResponseId: previousResponseId || null,
      conversationId: conversationId || null,
      sessionHash: hasOpaqueSessionAnchor ? context.sessionHash || null : null
    }
  }
}

module.exports = {
  classifyResponsesConversation
}
