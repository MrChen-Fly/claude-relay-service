const CODEX_CLI_PROMPT_PREFIX =
  "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer."
const NUMERIC_REQUEST_FIELDS = new Set([
  'temperature',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'n',
  'max_output_tokens'
])
const OMITTED_REQUEST_FIELDS = new Set([
  'stream',
  'prompt_cache_key',
  'promptCacheKey',
  'session_id',
  'conversation_id',
  'store'
])
const ALWAYS_DYNAMIC_REQUEST_FIELDS = ['background', 'web_search_options']

function normalizeText(text) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.replace(/\s+/g, ' ').trim()
}

function mapMessageRole(role) {
  if (role === 'developer') {
    return 'system'
  }

  return role || 'user'
}

function isMessageInputItem(item) {
  if (!item || typeof item !== 'object') {
    return false
  }

  return (
    item.type === 'message' ||
    item.type === 'chat_message' ||
    (item.type === undefined && (item.role || item.content !== undefined))
  )
}

function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return { supported: true, text: normalizeText(content) }
  }

  if (Array.isArray(content)) {
    const parts = []
    for (const item of content) {
      const result = extractTextFromContent(item)
      if (!result.supported) {
        return result
      }

      if (result.text) {
        parts.push(result.text)
      }
    }

    return { supported: true, text: parts.join(' ') }
  }

  if (!content || typeof content !== 'object') {
    return { supported: false, reason: 'unsupported_content_type' }
  }

  if (
    content.type === 'input_image' ||
    content.type === 'image_url' ||
    content.image_url ||
    content.image
  ) {
    return { supported: false, reason: 'unsupported_content_part' }
  }

  const value =
    typeof content.input_text === 'string'
      ? content.input_text
      : typeof content.output_text === 'string'
        ? content.output_text
        : typeof content.text === 'string'
          ? content.text
          : typeof content.content === 'string'
            ? content.content
            : ''

  if (!value) {
    return { supported: false, reason: 'unsupported_content_part' }
  }

  return { supported: true, text: normalizeText(value) }
}

function isCodexCliBoilerplate(text) {
  if (!text.startsWith(CODEX_CLI_PROMPT_PREFIX)) {
    return false
  }

  return text.includes('## General') && text.includes('## Editing constraints')
}

function normalizePromptText(text, { semanticMode = false, role = 'user' } = {}) {
  const normalized = normalizeText(text)
  if (!normalized) {
    return ''
  }

  if (semanticMode && role === 'system' && isCodexCliBoilerplate(normalized)) {
    return ''
  }

  return normalized
}

function appendCanonicalItem(items, role, text, name) {
  if (!text) {
    return
  }

  const normalizedRole = mapMessageRole(role)
  const normalizedName = normalizeText(name)
  const item = {
    role: normalizedRole,
    text
  }

  if (normalizedName) {
    item.name = normalizedName
  }

  const previous = items[items.length - 1]
  if (
    previous &&
    previous.role === item.role &&
    previous.name === item.name &&
    previous.text === item.text
  ) {
    return
  }

  items.push(item)
}

function normalizeStringValue(value) {
  return typeof value === 'string' ? value.trim() : value
}

function getNumericValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeScalarValue(key, value) {
  const normalized = normalizeStringValue(value)
  if (NUMERIC_REQUEST_FIELDS.has(key)) {
    const numericValue = getNumericValue(normalized)
    if (numericValue !== null) {
      return numericValue
    }
  }

  return normalized
}

function normalizeFunctionTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null
  }

  const type = normalizeStringValue(tool.type)
  if (type !== 'function') {
    return null
  }

  const sourceFunction = tool.function && typeof tool.function === 'object' ? tool.function : tool
  const name = normalizeStringValue(sourceFunction.name || tool.name)
  if (!name) {
    return null
  }

  const normalizedTool = {
    type: 'function',
    function: {
      name
    }
  }

  const description = normalizeText(sourceFunction.description || tool.description || '')
  if (description) {
    normalizedTool.function.description = description
  }

  const parameters = normalizeCacheValue(sourceFunction.parameters || tool.parameters, 'parameters')
  if (parameters && typeof parameters === 'object' && Object.keys(parameters).length > 0) {
    normalizedTool.function.parameters = parameters
  }

  if (typeof sourceFunction.strict === 'boolean') {
    normalizedTool.function.strict = sourceFunction.strict
  }

  return normalizedTool
}

function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) {
    return null
  }

  return tools
    .map((tool) => normalizeFunctionTool(tool))
    .filter(Boolean)
    .sort((left, right) => {
      const leftName = left.function?.name || ''
      const rightName = right.function?.name || ''
      return leftName.localeCompare(rightName)
    })
}

function isCacheSafeFunctionTool(tool) {
  return Boolean(normalizeFunctionTool(tool))
}

function hasUnsafeToolDefinitions(requestBody = {}) {
  const { tools } = requestBody
  if (tools === undefined || tools === null) {
    return false
  }

  if (!Array.isArray(tools)) {
    return true
  }

  return tools.some((tool) => !isCacheSafeFunctionTool(tool))
}

function hasAlwaysDynamicFields(requestBody = {}) {
  return ALWAYS_DYNAMIC_REQUEST_FIELDS.some((field) => {
    const value = requestBody[field]
    if (Array.isArray(value)) {
      return value.length > 0
    }

    return value !== undefined && value !== null && value !== false
  })
}

function normalizeToolChoice(choice, options = {}) {
  const { omitAuto = false } = options

  if (choice === undefined || choice === null || choice === '') {
    return undefined
  }

  if (typeof choice === 'string') {
    const normalizedChoice = choice.trim().toLowerCase()
    if (!normalizedChoice) {
      return undefined
    }

    if (omitAuto && normalizedChoice === 'auto') {
      return undefined
    }

    return normalizedChoice
  }

  if (typeof choice !== 'object') {
    return normalizeScalarValue('tool_choice', choice)
  }

  const normalizedType = normalizeStringValue(choice.type || '')
  const normalizedName = normalizeStringValue(choice.name || choice.function?.name || '')

  if ((normalizedType === 'function' || !normalizedType) && normalizedName) {
    return {
      type: 'function',
      name: normalizedName
    }
  }

  const normalized = {}
  for (const key of Object.keys(choice).sort()) {
    const normalizedValue = normalizeCacheValue(choice[key], key)
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue
    }
  }

  if (Object.keys(normalized).length === 0) {
    return undefined
  }

  if (omitAuto && normalized.type === 'auto') {
    return undefined
  }

  return normalized
}

function getToolChoiceMode(choice) {
  const normalizedChoice = normalizeToolChoice(choice)
  if (normalizedChoice === undefined) {
    return 'auto'
  }

  if (typeof normalizedChoice === 'string') {
    return normalizedChoice
  }

  if (normalizedChoice.type === 'function' && normalizedChoice.name) {
    return `function:${normalizedChoice.name}`
  }

  return normalizedChoice.type || 'custom'
}

function normalizeTextFormat(format) {
  if (format === undefined || format === null) {
    return undefined
  }

  if (typeof format !== 'object') {
    return normalizeScalarValue('format', format)
  }

  const normalized = {}
  for (const key of Object.keys(format).sort()) {
    const normalizedValue = normalizeCacheValue(format[key], key)
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue
    }
  }

  if (normalized.type === 'text' && Object.keys(normalized).length === 1) {
    return undefined
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isStructuredOutputRequest(requestBody = {}) {
  const textFormat = requestBody?.text?.format
  const normalizedTextFormat = normalizeTextFormat(textFormat)
  if (normalizedTextFormat && normalizedTextFormat.type && normalizedTextFormat.type !== 'text') {
    return true
  }

  const responseFormat = requestBody?.response_format
  if (!responseFormat || typeof responseFormat !== 'object') {
    return false
  }

  const normalizedResponseFormat = {}
  for (const key of Object.keys(responseFormat).sort()) {
    const normalizedValue = normalizeCacheValue(responseFormat[key], key)
    if (normalizedValue !== undefined) {
      normalizedResponseFormat[key] = normalizedValue
    }
  }

  return Boolean(normalizedResponseFormat.type && normalizedResponseFormat.type !== 'text')
}

function buildToolProfile(requestBody = {}, options = {}) {
  const { semanticSafeOnly = false } = options
  const { tools } = requestBody
  if (tools === undefined || tools === null) {
    return {
      supported: true,
      hasTools: false,
      tools: [],
      choiceMode: 'auto',
      parallelToolCalls: null
    }
  }

  const normalizedTools = normalizeToolDefinitions(tools)
  if (!normalizedTools || normalizedTools.length !== tools.length) {
    return {
      supported: false,
      reason: semanticSafeOnly ? 'dynamic_request' : 'dynamic_tools'
    }
  }

  const choiceMode = getToolChoiceMode(requestBody.tool_choice)
  if (semanticSafeOnly && choiceMode.startsWith('function:')) {
    return {
      supported: false,
      reason: 'dynamic_request'
    }
  }

  return {
    supported: true,
    hasTools: normalizedTools.length > 0,
    tools: normalizedTools,
    choiceMode,
    parallelToolCalls: normalizedTools.length > 0 ? requestBody.parallel_tool_calls !== false : null
  }
}

function normalizeCacheValue(value, parentKey = '') {
  if (Array.isArray(value)) {
    if (parentKey === 'tools') {
      return (
        normalizeToolDefinitions(value) || value.map((item) => normalizeCacheValue(item, parentKey))
      )
    }

    return value.map((item) => normalizeCacheValue(item, parentKey))
  }

  if (!value || typeof value !== 'object') {
    return normalizeScalarValue(parentKey, value)
  }

  if (parentKey === 'tool_choice') {
    return normalizeToolChoice(value, { omitAuto: true })
  }

  if (parentKey === 'text' || parentKey === 'response_text') {
    const normalized = {}
    for (const key of Object.keys(value).sort()) {
      const normalizedValue =
        key === 'format' ? normalizeTextFormat(value[key]) : normalizeCacheValue(value[key], key)

      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  const normalized = {}
  for (const key of Object.keys(value).sort()) {
    if (OMITTED_REQUEST_FIELDS.has(key)) {
      continue
    }

    if (key === 'tool_choice') {
      const normalizedToolChoice = normalizeToolChoice(value[key], { omitAuto: true })
      if (normalizedToolChoice !== undefined) {
        normalized[key] = normalizedToolChoice
      }
      continue
    }

    if (key === 'parallel_tool_calls' && value[key] === true) {
      continue
    }

    const normalizedValue = normalizeCacheValue(value[key], key)
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue
    }
  }

  return normalized
}

function buildCanonicalPrompt(requestBody = {}, options = {}) {
  const { semanticMode = false } = options
  const items = []

  if (requestBody.instructions !== undefined) {
    if (typeof requestBody.instructions !== 'string') {
      return { supported: false, reason: 'unsupported_instructions' }
    }

    appendCanonicalItem(
      items,
      'system',
      normalizePromptText(requestBody.instructions, {
        semanticMode,
        role: 'system'
      })
    )
  }

  const sourceItems = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : Array.isArray(requestBody.input)
      ? requestBody.input
      : requestBody.input !== undefined && requestBody.input !== null
        ? [requestBody.input]
        : []

  for (const item of sourceItems) {
    if (typeof item === 'string') {
      appendCanonicalItem(items, 'user', normalizePromptText(item, { semanticMode, role: 'user' }))
      continue
    }

    if (!item || typeof item !== 'object') {
      return { supported: false, reason: 'unsupported_input_item' }
    }

    if (isMessageInputItem(item)) {
      const contentResult = extractTextFromContent(item.content)
      if (!contentResult.supported) {
        return contentResult
      }

      appendCanonicalItem(
        items,
        item.role,
        normalizePromptText(contentResult.text, {
          semanticMode,
          role: mapMessageRole(item.role)
        }),
        item.name
      )
      continue
    }

    const contentResult = extractTextFromContent(item)
    if (!contentResult.supported) {
      return { supported: false, reason: 'unsupported_input_item' }
    }

    appendCanonicalItem(
      items,
      'user',
      normalizePromptText(contentResult.text, { semanticMode, role: 'user' })
    )
  }

  if (!items.length) {
    return { supported: false, reason: 'missing_text_input' }
  }

  const focalItem =
    [...items].reverse().find((item) => item.role === 'user' && item.text) ||
    items[items.length - 1]

  return {
    supported: true,
    items,
    text: items.map((item) => `${item.role}: ${item.text}`).join('\n'),
    focalText: focalItem?.text || ''
  }
}

module.exports = {
  normalizeText,
  normalizeCacheValue,
  normalizeFunctionTool,
  normalizeToolDefinitions,
  normalizeToolChoice,
  buildToolProfile,
  hasAlwaysDynamicFields,
  hasUnsafeToolDefinitions,
  isStructuredOutputRequest,
  mapMessageRole,
  isMessageInputItem,
  extractTextFromContent,
  buildCanonicalPrompt,
  isCodexCliBoilerplate,
  isCacheSafeFunctionTool,
  getToolChoiceMode
}
