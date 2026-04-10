const crypto = require('crypto')
const { buildToolingExactKeyInput, stableStringify } = require('./requestCacheFingerprint')

function normalizeText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}

function stringifyStructuredValue(value) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return normalizeText(value)
  }

  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function normalizeStructuredArguments(value) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) {
      return ''
    }

    try {
      return stableStringify(JSON.parse(normalized))
    } catch (_) {
      return normalizeText(normalized)
    }
  }

  return stableStringify(value)
}

function extractToolCallSignature(toolCalls = [], legacyFunctionCall = null) {
  const normalizedToolCalls = Array.isArray(toolCalls) ? toolCalls : []
  const signatures = normalizedToolCalls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object') {
        return ''
      }

      const functionName =
        toolCall.function?.name || toolCall.name || (toolCall.type === 'function' ? 'function' : '')
      const argumentsValue =
        toolCall.function?.arguments ?? toolCall.arguments ?? toolCall.input ?? null

      return normalizeText(`${functionName} ${normalizeStructuredArguments(argumentsValue)}`)
    })
    .filter(Boolean)

  if (legacyFunctionCall && typeof legacyFunctionCall === 'object') {
    const functionName = legacyFunctionCall.name || 'function'
    signatures.push(
      normalizeText(`${functionName} ${normalizeStructuredArguments(legacyFunctionCall.arguments)}`)
    )
  }

  return normalizeText(signatures.join(' | '))
}

function extractContentText(content) {
  if (typeof content === 'string') {
    return normalizeText(content)
  }

  if (!Array.isArray(content)) {
    if (content && typeof content === 'object') {
      return normalizeText(
        content.text ||
          content.input_text ||
          content.output_text ||
          stringifyStructuredValue(content)
      )
    }
    return ''
  }

  return normalizeText(
    content
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return ''
        }

        return item.text || item.input_text || item.output_text || ''
      })
      .filter(Boolean)
      .join(' ')
  )
}

function extractChatMessages(body = {}) {
  const messages = []

  if (body.instructions) {
    messages.push({
      role: 'system',
      content: normalizeText(body.instructions)
    })
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== 'object') {
        continue
      }

      messages.push({
        role: typeof message.role === 'string' ? message.role : 'user',
        content: extractContentText(message.content),
        hasToolCalls: Array.isArray(message.tool_calls) && message.tool_calls.length > 0,
        toolCallSignature: extractToolCallSignature(message.tool_calls, message.function_call)
      })
    }
  }

  return messages
}

function extractResponsesMessages(body = {}) {
  const messages = []

  if (body.instructions) {
    messages.push({
      role: 'system',
      content: normalizeText(body.instructions)
    })
  }

  if (typeof body.input === 'string') {
    messages.push({
      role: 'user',
      content: normalizeText(body.input)
    })
    return messages
  }

  const inputItems = Array.isArray(body.input) ? body.input : body.input ? [body.input] : []

  for (const item of inputItems) {
    if (typeof item === 'string') {
      messages.push({
        role: 'user',
        content: normalizeText(item)
      })
      continue
    }

    if (!item || typeof item !== 'object') {
      continue
    }

    if (
      item.type === 'message' ||
      (item.type === undefined && (item.role || item.content !== undefined))
    ) {
      messages.push({
        role: typeof item.role === 'string' ? item.role : 'user',
        content: extractContentText(item.content),
        hasToolCalls: false
      })
      continue
    }

    if (item.type === 'input_text' && typeof item.text === 'string') {
      messages.push({
        role: 'user',
        content: normalizeText(item.text)
      })
      continue
    }

    if (item.type === 'function_call') {
      messages.push({
        role: 'assistant',
        content: normalizeText(
          `${item.name || 'function_call'} ${stringifyStructuredValue(item.arguments)}`
        ),
        hasToolCalls: true,
        toolCallSignature: normalizeText(
          `${item.name || 'function_call'} ${normalizeStructuredArguments(item.arguments)}`
        )
      })
      continue
    }

    if (item.type === 'function_call_output') {
      messages.push({
        role: 'tool',
        content: extractContentText(item.output)
      })
    }
  }

  return messages
}

function extractMessages(body = {}, endpointPath = '') {
  const normalizedPath = String(endpointPath || '').toLowerCase()
  if (normalizedPath.includes('/responses') || body.input !== undefined || body.instructions) {
    return extractResponsesMessages(body)
  }

  return extractChatMessages(body)
}

function buildTranscript(messages = []) {
  return messages
    .filter((message) => message && message.content)
    .map((message) => `${message.role || 'user'}:${message.content}`)
    .join('\n')
}

function extractLatestUserPrompt(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.content) {
      return message.content
    }
  }

  return ''
}

function extractSystemText(messages = []) {
  return messages
    .filter((message) => message?.role === 'system' && message.content)
    .map((message) => message.content)
    .join('\n')
}

function hasStructuredOutput(body = {}) {
  const responseFormatType = body.response_format?.type
  const textFormatType = body.text?.format?.type

  return (
    responseFormatType === 'json_object' ||
    responseFormatType === 'json_schema' ||
    textFormatType === 'json_object' ||
    textFormatType === 'json_schema'
  )
}

function hasDynamicTooling(body = {}, messages = []) {
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    return true
  }

  const toolChoice = body.tool_choice
  if (
    toolChoice &&
    !(typeof toolChoice === 'string' && toolChoice.trim().toLowerCase() === 'auto')
  ) {
    return true
  }

  return messages.some((message) => message?.role === 'tool' || message?.hasToolCalls === true)
}

function isDeterministicTemperature(body = {}) {
  if (body.temperature === undefined || body.temperature === null || body.temperature === '') {
    return true
  }

  const numericTemperature = Number(body.temperature)
  if (!Number.isFinite(numericTemperature)) {
    return false
  }

  return numericTemperature === 0
}

function buildSemanticScope({ requestBody = {}, endpointPath = '', systemText = '' } = {}) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        endpointPath: String(endpointPath || '').replace(/^\/v1\//, '/'),
        model: requestBody.model || null,
        systemText: systemText || ''
      })
    )
    .digest('hex')
}

function evaluateTokenCacheRequest(context = {}) {
  const requestBody =
    context.requestBody && typeof context.requestBody === 'object' ? context.requestBody : {}
  const messages = extractMessages(requestBody, context.endpointPath)
  const promptText = extractLatestUserPrompt(messages)
  const messageText = buildTranscript(messages)
  const systemText = extractSystemText(messages)
  const hasTooling = hasDynamicTooling(requestBody, messages)

  if (hasStructuredOutput(requestBody)) {
    return { eligible: false, reason: 'structured_output' }
  }

  if (!isDeterministicTemperature(requestBody)) {
    return { eligible: false, reason: 'non_deterministic_temperature' }
  }

  if (!promptText || !messageText) {
    return { eligible: false, reason: 'empty_prompt' }
  }

  const scopeKey = buildSemanticScope({
    requestBody,
    endpointPath: context.endpointPath,
    systemText
  })

  return {
    eligible: true,
    reason: '',
    promptText,
    systemText,
    scopeKey,
    semanticEligible: !hasTooling,
    cacheStrategy: hasTooling ? 'exact_only' : 'semantic_first',
    exactKeyInput: hasTooling
      ? buildToolingExactKeyInput({
          endpointPath: context.endpointPath,
          requestBody,
          messages
        })
      : JSON.stringify({
          scopeKey,
          promptText
        })
  }
}

module.exports = {
  evaluateTokenCacheRequest,
  extractMessages,
  extractLatestUserPrompt,
  normalizeText
}
