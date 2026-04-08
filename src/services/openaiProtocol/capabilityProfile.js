const openaiResponsesAccountService = require('../account/openaiResponsesAccountService')

function hasToolCallsInMessages(messages = []) {
  return messages.some((message) => {
    if (!message || typeof message !== 'object') {
      return false
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return true
    }
    return message.role === 'tool' || Boolean(message.tool_call_id)
  })
}

function hasResponsesToolItems(input = []) {
  const items = Array.isArray(input) ? input : [input]
  return items.some((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }
    return item.type === 'function_call' || item.type === 'function_call_output'
  })
}

function normalizeCapabilityFlag(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  return fallback
}

function inferRequestCapabilities(requestBody = {}, clientProtocol = 'chat_completions') {
  const profile = {
    clientProtocol,
    needsStreaming: requestBody.stream !== false,
    needsTools: false,
    needsReasoning: false,
    needsJsonSchema: false,
    needsNonStreamingResponses: false
  }

  if (clientProtocol === 'responses') {
    profile.needsTools =
      (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) ||
      requestBody.tool_choice === 'required' ||
      requestBody.tool_choice === 'auto' ||
      hasResponsesToolItems(requestBody.input)
    profile.needsReasoning = Boolean(requestBody.reasoning?.effort)
    profile.needsJsonSchema = requestBody.text?.format?.type === 'json_schema'
    profile.needsNonStreamingResponses = requestBody.stream === false
    return profile
  }

  profile.needsTools =
    (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) ||
    requestBody.tool_choice === 'required' ||
    requestBody.tool_choice === 'auto' ||
    hasToolCallsInMessages(requestBody.messages)
  profile.needsReasoning = Boolean(requestBody.reasoning_effort)
  profile.needsJsonSchema = requestBody.response_format?.type === 'json_schema'
  return profile
}

function inferAccountCapabilities(account = {}, accountType = 'openai') {
  if (accountType === 'openai') {
    return {
      providerEndpoint: 'responses',
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsJsonSchema: true,
      supportsNonStreamingResponses: true
    }
  }

  const providerEndpoint = openaiResponsesAccountService.normalizeProviderEndpoint(
    account.providerEndpoint
  )

  const defaultCapabilities =
    providerEndpoint === 'responses'
      ? {
          supportsStreaming: true,
          supportsTools: true,
          supportsReasoning: true,
          supportsJsonSchema: true,
          supportsNonStreamingResponses: true
        }
      : {
          supportsStreaming: true,
          supportsTools: true,
          supportsReasoning: true,
          supportsJsonSchema: false,
          supportsNonStreamingResponses: true
        }

  return {
    providerEndpoint,
    supportsStreaming: normalizeCapabilityFlag(
      account.supportsStreaming,
      defaultCapabilities.supportsStreaming
    ),
    supportsTools: normalizeCapabilityFlag(
      account.supportsTools,
      defaultCapabilities.supportsTools
    ),
    supportsReasoning: normalizeCapabilityFlag(
      account.supportsReasoning,
      defaultCapabilities.supportsReasoning
    ),
    supportsJsonSchema: normalizeCapabilityFlag(
      account.supportsJsonSchema,
      defaultCapabilities.supportsJsonSchema
    ),
    supportsNonStreamingResponses: normalizeCapabilityFlag(
      account.supportsNonStreamingResponses,
      defaultCapabilities.supportsNonStreamingResponses
    )
  }
}

function getCapabilityMismatchReasons(requestCapabilities = {}, accountCapabilities = {}) {
  const reasons = []

  if (requestCapabilities.needsStreaming && !accountCapabilities.supportsStreaming) {
    reasons.push('streaming')
  }
  if (requestCapabilities.needsTools && !accountCapabilities.supportsTools) {
    reasons.push('tools')
  }
  if (requestCapabilities.needsReasoning && !accountCapabilities.supportsReasoning) {
    reasons.push('reasoning')
  }
  if (requestCapabilities.needsJsonSchema && !accountCapabilities.supportsJsonSchema) {
    reasons.push('json_schema')
  }
  if (
    requestCapabilities.needsNonStreamingResponses &&
    !accountCapabilities.supportsNonStreamingResponses
  ) {
    reasons.push('non_stream_responses')
  }

  return reasons
}

function isAccountCompatible(requestCapabilities = {}, accountCapabilities = {}) {
  return getCapabilityMismatchReasons(requestCapabilities, accountCapabilities).length === 0
}

module.exports = {
  inferRequestCapabilities,
  inferAccountCapabilities,
  getCapabilityMismatchReasons,
  isAccountCompatible,
  normalizeCapabilityFlag
}
