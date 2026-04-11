function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item))
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = sortDeep(value[key])
        return accumulator
      }, {})
  }

  return value
}

function stableStringify(value) {
  try {
    return JSON.stringify(sortDeep(value))
  } catch (_) {
    return JSON.stringify(String(value ?? ''))
  }
}

function buildToolingExactKeyInput({
  endpointPath = '',
  requestBody = {},
  messages = [],
  stateAnchor = {},
  requestClass = ''
} = {}) {
  return stableStringify({
    endpointPath: String(endpointPath || '').replace(/^\/v1\//, '/'),
    model: requestBody.model || null,
    messages: messages.map((message) => ({
      role: message?.role || 'user',
      content: message?.content || '',
      hasToolCalls: message?.hasToolCalls === true,
      toolCallSignature: message?.toolCallSignature || ''
    })),
    tools: Array.isArray(requestBody.tools) ? requestBody.tools : [],
    toolChoice: requestBody.tool_choice ?? null,
    parallelToolCalls: requestBody.parallel_tool_calls ?? null,
    reasoning: requestBody.reasoning ?? null,
    maxOutputTokens: requestBody.max_output_tokens ?? requestBody.max_completion_tokens ?? null,
    responseFormat: requestBody.response_format ?? null,
    textFormat: requestBody.text ?? null,
    include: requestBody.include ?? null,
    store: requestBody.store ?? null,
    requestClass: requestClass || null,
    previousResponseId:
      requestBody.previous_response_id ??
      requestBody.previousResponseId ??
      stateAnchor.previousResponseId ??
      null,
    conversationId:
      requestBody.conversation_id ??
      requestBody.conversationId ??
      stateAnchor.conversationId ??
      null,
    sessionHash: stateAnchor.sessionHash || null
  })
}

module.exports = {
  buildToolingExactKeyInput,
  stableStringify
}
