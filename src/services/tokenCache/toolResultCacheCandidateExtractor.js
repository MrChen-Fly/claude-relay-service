const crypto = require('crypto')
const { stableStringify } = require('./requestCacheFingerprint')

function normalizeText(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.replace(/\s+/g, ' ').trim()
}

function normalizeStructuredValue(value) {
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

function normalizeEndpointPath(endpointPath = '') {
  return String(endpointPath || '').replace(/^\/v1\//, '/')
}

function buildToolDeclarationMap(tools = []) {
  const toolMap = new Map()

  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool !== 'object') {
      continue
    }

    const toolName = normalizeText(tool.function?.name || tool.name || '')
    if (!toolName) {
      continue
    }

    toolMap.set(toolName, tool)
  }

  return toolMap
}

function buildToolSchemaFingerprint(toolDeclaration = null) {
  if (!toolDeclaration || typeof toolDeclaration !== 'object') {
    return ''
  }

  return crypto.createHash('sha256').update(stableStringify(toolDeclaration)).digest('hex')
}

function buildToolResultCandidate({
  endpointPath = '',
  requestBody = {},
  callId = '',
  toolName = '',
  canonicalArguments = '',
  canonicalOutput = '',
  toolSchemaFingerprint = ''
} = {}) {
  const keyInput = stableStringify({
    endpointPath: normalizeEndpointPath(endpointPath),
    model: requestBody.model || null,
    toolName,
    canonicalArguments,
    canonicalOutput,
    toolSchemaFingerprint
  })

  return {
    endpointPath: normalizeEndpointPath(endpointPath),
    requestedModel: requestBody.model || null,
    toolCallId: callId || '',
    toolName,
    canonicalArguments,
    canonicalOutput,
    toolSchemaFingerprint,
    keyInput
  }
}

function extractResponsesCandidates({ requestBody = {}, endpointPath = '' } = {}) {
  const inputItems = Array.isArray(requestBody.input)
    ? requestBody.input
    : requestBody.input
      ? [requestBody.input]
      : []
  const toolDeclarations = buildToolDeclarationMap(requestBody.tools)
  const callMap = new Map()
  const candidates = []

  for (const item of inputItems) {
    if (!item || typeof item !== 'object') {
      continue
    }

    if (item.type === 'function_call') {
      const toolName = normalizeText(item.name || '')
      if (!toolName || !item.call_id) {
        continue
      }

      callMap.set(String(item.call_id), {
        toolName,
        canonicalArguments: normalizeStructuredValue(item.arguments),
        toolSchemaFingerprint: buildToolSchemaFingerprint(toolDeclarations.get(toolName))
      })
      continue
    }

    if (item.type !== 'function_call_output' || !item.call_id) {
      continue
    }

    const toolCall = callMap.get(String(item.call_id))
    if (!toolCall?.toolName) {
      continue
    }

    const canonicalOutput = normalizeStructuredValue(item.output)
    if (!canonicalOutput) {
      continue
    }

    candidates.push(
      buildToolResultCandidate({
        endpointPath,
        requestBody,
        callId: String(item.call_id),
        toolName: toolCall.toolName,
        canonicalArguments: toolCall.canonicalArguments,
        canonicalOutput,
        toolSchemaFingerprint: toolCall.toolSchemaFingerprint
      })
    )
  }

  return candidates
}

function extractChatCandidates({ requestBody = {}, endpointPath = '' } = {}) {
  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : []
  const toolDeclarations = buildToolDeclarationMap(requestBody.tools)
  const callMap = new Map()
  const candidates = []

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    if (message.role === 'assistant') {
      const toolCalls = []

      if (Array.isArray(message.tool_calls)) {
        toolCalls.push(...message.tool_calls)
      }

      if (message.function_call && typeof message.function_call === 'object') {
        toolCalls.push({
          id: message.function_call.id || message.function_call.call_id || 'legacy_function_call',
          type: 'function',
          function: {
            name: message.function_call.name,
            arguments: message.function_call.arguments
          }
        })
      }

      for (const toolCall of toolCalls) {
        const toolName = normalizeText(toolCall.function?.name || toolCall.name || '')
        const toolCallId = normalizeText(toolCall.id || toolCall.call_id || '')

        if (!toolName || !toolCallId) {
          continue
        }

        callMap.set(toolCallId, {
          toolName,
          canonicalArguments: normalizeStructuredValue(
            toolCall.function?.arguments ?? toolCall.arguments
          ),
          toolSchemaFingerprint: buildToolSchemaFingerprint(toolDeclarations.get(toolName))
        })
      }

      continue
    }

    if (message.role !== 'tool') {
      continue
    }

    const toolCallId = normalizeText(message.tool_call_id || message.call_id || '')
    if (!toolCallId) {
      continue
    }

    const toolCall = callMap.get(toolCallId)
    if (!toolCall?.toolName) {
      continue
    }

    const canonicalOutput = normalizeStructuredValue(message.content)
    if (!canonicalOutput) {
      continue
    }

    candidates.push(
      buildToolResultCandidate({
        endpointPath,
        requestBody,
        callId: toolCallId,
        toolName: toolCall.toolName,
        canonicalArguments: toolCall.canonicalArguments,
        canonicalOutput,
        toolSchemaFingerprint: toolCall.toolSchemaFingerprint
      })
    )
  }

  return candidates
}

/**
 * Extract normalized tool-result cache candidates from a chat or responses request.
 */
function extractToolResultCacheCandidates(context = {}) {
  const requestBody =
    context.requestBody && typeof context.requestBody === 'object' ? context.requestBody : {}
  const endpointPath = context.endpointPath || ''

  if (
    endpointPath.toLowerCase().includes('/responses') ||
    requestBody.input !== undefined ||
    requestBody.instructions !== undefined
  ) {
    return extractResponsesCandidates({ requestBody, endpointPath })
  }

  return extractChatCandidates({ requestBody, endpointPath })
}

module.exports = {
  extractToolResultCacheCandidates
}
