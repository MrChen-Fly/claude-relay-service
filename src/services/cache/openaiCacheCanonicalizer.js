const crypto = require('crypto')

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
  'prompt_cache_retention',
  'session_id',
  'conversation_id',
  'store',
  'user',
  'metadata',
  'service_tier',
  'safety_identifier',
  'tool_usage',
  'usage'
])
const ALWAYS_DYNAMIC_REQUEST_FIELDS = ['background', 'web_search_options']
const ALWAYS_DYNAMIC_REQUEST_REASON_MAP = {
  background: 'request_background',
  web_search_options: 'request_web_search_options'
}
const LOW_SIGNAL_FOLLOW_UP_PATTERN =
  /^(continue|go on|keep going|again|retry|regenerate|same again|do it|proceed|继续|接着|继续写|继续做|再来一次|重试一下|按上面|照上面|基于上面|接着改|继续优化|改一下|优化一下|然后呢)$/i
const SEMANTIC_RECALL_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'assistant',
  'for',
  'from',
  'help',
  'into',
  'of',
  'on',
  'or',
  'please',
  'pls',
  'system',
  'that',
  'the',
  'this',
  'to',
  'user'
])

function normalizeText(text) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.replace(/\s+/g, ' ').trim()
}

function createHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function tokenizeSemanticText(text = '') {
  if (typeof text !== 'string') {
    return []
  }

  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function looksLikeLowSignalFollowUp(text = '') {
  const normalized = normalizeText(text)
  if (!normalized) {
    return false
  }

  if (LOW_SIGNAL_FOLLOW_UP_PATTERN.test(normalized)) {
    return true
  }

  const tokens = tokenizeSemanticText(normalized)
  if (!tokens.length) {
    return false
  }

  return tokens.every((token) =>
    ['continue', 'again', 'retry', 'proceed', '继续', '接着', '然后', '上面'].includes(token)
  )
}

function extractUserTextsFromCanonicalRequest(requestText = '') {
  if (typeof requestText !== 'string') {
    return []
  }

  return requestText
    .split(/\r?\n/u)
    .map((line) => normalizeText(line))
    .filter((line) => line.toLowerCase().startsWith('user:'))
    .map((line) => normalizeText(line.slice(5)))
    .filter(Boolean)
}

function buildSemanticQueryText(canonicalPrompt = {}, options = {}) {
  if (!canonicalPrompt?.supported) {
    return ''
  }

  const items = Array.isArray(canonicalPrompt.items) ? canonicalPrompt.items : []
  const userTurns = items
    .filter((item) => item?.role === 'user' && item.text)
    .map((item) => item.text)
  const focalText = normalizeText(
    userTurns[userTurns.length - 1] || canonicalPrompt.focalText || canonicalPrompt.text
  )

  if (!focalText) {
    return ''
  }

  if (!looksLikeLowSignalFollowUp(focalText)) {
    return focalText
  }

  const history = []
  const appendUnique = (value) => {
    const normalized = normalizeText(value)
    if (!normalized || normalized === focalText || history.includes(normalized)) {
      return
    }

    history.push(normalized)
  }

  userTurns.slice(0, -1).slice(-2).forEach(appendUnique)

  const contextItems = Array.isArray(options.cacheContext?.items) ? options.cacheContext.items : []
  contextItems.slice(-2).forEach((item) => {
    const userTexts = extractUserTextsFromCanonicalRequest(item?.requestText)
    const latestUserText = userTexts[userTexts.length - 1]
    appendUnique(latestUserText)
  })

  const enrichedSegments = [...history.slice(-2), focalText]
  return enrichedSegments.join('\n').trim()
}

function buildRecallTokens(text = '', options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 6
  const tokens = tokenizeSemanticText(text)
  const uniqueTokens = []

  for (const token of tokens) {
    if (SEMANTIC_RECALL_STOP_WORDS.has(token) || looksLikeLowSignalFollowUp(token)) {
      continue
    }

    if (/^[a-z0-9]+$/u.test(token) && token.length < 2) {
      continue
    }

    if (!uniqueTokens.includes(token)) {
      uniqueTokens.push(token)
    }
  }

  return uniqueTokens.sort((left, right) => right.length - left.length).slice(0, limit)
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
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const normalized = normalizeStringValue(value)
  if (NUMERIC_REQUEST_FIELDS.has(key)) {
    const numericValue = getNumericValue(normalized)
    if (numericValue !== null) {
      return numericValue
    }
  }

  return normalized
}

/**
 * Ensures function tool parameter schemas remain acceptable to Responses-style
 * upstream APIs that require object schemas to declare `properties`.
 *
 * @param {object|undefined} parameters
 * @returns {object|undefined}
 */
function normalizeFunctionParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return parameters
  }

  if (parameters.type !== 'object' || parameters.properties !== undefined) {
    return parameters
  }

  return {
    ...parameters,
    properties: {}
  }
}

function normalizeGenericStructuredValue(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizeGenericStructuredValue(item))
      .filter((item) => item !== undefined)

    return normalizedItems.length > 0 ? normalizedItems : undefined
  }

  if (typeof value === 'object') {
    const normalized = {}

    for (const key of Object.keys(value).sort()) {
      const normalizedValue = normalizeGenericStructuredValue(value[key])
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  if (typeof value === 'string') {
    const normalizedText = normalizeText(value)
    return normalizedText || undefined
  }

  return value
}

function tryParseJsonPayload(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || !/^[[{]/u.test(trimmed)) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch (_) {
    return null
  }
}

function stringifyNormalizedPayload(value, options = {}) {
  const { semanticMode = false } = options
  const maxLength = semanticMode ? options.maxLength || 600 : 0
  let normalizedValue = value

  if (typeof value === 'string') {
    const parsedJson = tryParseJsonPayload(value)
    normalizedValue =
      parsedJson === null ? normalizeText(value) : normalizeGenericStructuredValue(parsedJson)
  } else {
    normalizedValue = normalizeGenericStructuredValue(value)
  }

  if (normalizedValue === undefined || normalizedValue === null || normalizedValue === '') {
    return ''
  }

  const text =
    typeof normalizedValue === 'string' ? normalizedValue : JSON.stringify(normalizedValue)
  const normalizedText = normalizeText(text)

  if (!normalizedText) {
    return ''
  }

  if (maxLength > 0 && normalizedText.length > maxLength) {
    return `${normalizedText.slice(0, maxLength)} [${createHash(normalizedText).slice(0, 8)}]`
  }

  return normalizedText
}

function normalizeFunctionTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null
  }

  const type = normalizeStringValue(tool.type)
  const sourceFunction = tool.function && typeof tool.function === 'object' ? tool.function : tool
  const name = normalizeStringValue(sourceFunction.name || tool.name)
  const normalizedType = type || (name ? 'function' : '')
  if (normalizedType !== 'function') {
    return null
  }

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

  const parameters = normalizeFunctionParameters(
    normalizeCacheValue(sourceFunction.parameters || tool.parameters, 'parameters')
  )
  if (parameters && typeof parameters === 'object' && Object.keys(parameters).length > 0) {
    normalizedTool.function.parameters = parameters
  }

  if (typeof sourceFunction.strict === 'boolean') {
    normalizedTool.function.strict = sourceFunction.strict
  }

  return normalizedTool
}

function normalizeCustomTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null
  }

  const type = normalizeStringValue(tool.type)
  if (type !== 'custom') {
    return null
  }

  const name = normalizeStringValue(tool.name || tool.custom?.name)
  if (!name) {
    return null
  }

  const normalizedTool = {
    type: 'custom',
    name
  }

  const description = normalizeText(tool.description || tool.custom?.description || '')
  if (description) {
    normalizedTool.description = description
  }

  const format = normalizeGenericStructuredValue(tool.format || tool.custom?.format)
  if (format !== undefined) {
    normalizedTool.format = format
  }

  for (const key of Object.keys(tool).sort()) {
    if (['custom', 'description', 'format', 'name', 'type'].includes(key)) {
      continue
    }

    const normalizedValue = normalizeGenericStructuredValue(tool[key])
    if (normalizedValue !== undefined) {
      normalizedTool[key] = normalizedValue
    }
  }

  return normalizedTool
}

function normalizeWebSearchTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null
  }

  const type = normalizeStringValue(tool.type)
  if (type !== 'web_search' && type !== 'web_search_preview') {
    return null
  }

  const normalizedTool = {
    type
  }

  const description = normalizeText(tool.description || '')
  if (description) {
    normalizedTool.description = description
  }

  for (const key of Object.keys(tool).sort()) {
    if (['description', 'type'].includes(key)) {
      continue
    }

    const normalizedValue = normalizeGenericStructuredValue(tool[key])
    if (normalizedValue !== undefined) {
      normalizedTool[key] = normalizedValue
    }
  }

  return normalizedTool
}

function normalizeCacheSafeTool(tool) {
  return normalizeFunctionTool(tool) || normalizeCustomTool(tool) || normalizeWebSearchTool(tool)
}

function getToolSortKey(tool) {
  const type = normalizeStringValue(tool?.type || '')
  const name = normalizeStringValue(tool?.function?.name || tool?.name || '')
  return `${type}:${name}:${JSON.stringify(tool)}`
}

function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) {
    return null
  }

  return tools
    .map((tool) => normalizeCacheSafeTool(tool))
    .filter(Boolean)
    .sort((left, right) => getToolSortKey(left).localeCompare(getToolSortKey(right)))
}

function toResponsesFunctionTool(tool) {
  const normalizedTool = normalizeFunctionTool(tool)
  if (!normalizedTool) {
    return null
  }

  const functionDefinition = normalizedTool.function || {}
  const responseTool = {
    type: 'function',
    name: functionDefinition.name
  }

  if (functionDefinition.description) {
    responseTool.description = functionDefinition.description
  }

  if (functionDefinition.parameters) {
    responseTool.parameters = functionDefinition.parameters
  }

  if (typeof functionDefinition.strict === 'boolean') {
    responseTool.strict = functionDefinition.strict
  }

  return responseTool
}

function isCacheSafeFunctionTool(tool) {
  return Boolean(normalizeCacheSafeTool(tool))
}

function hasUnsafeToolDefinitions(requestBody = {}) {
  return Boolean(getUnsupportedToolReason(requestBody))
}

function hasAlwaysDynamicFields(requestBody = {}) {
  return Boolean(getAlwaysDynamicRequestReason(requestBody))
}

function getAlwaysDynamicRequestReason(requestBody = {}) {
  const activeField = ALWAYS_DYNAMIC_REQUEST_FIELDS.find((field) => {
    const value = requestBody[field]
    if (Array.isArray(value)) {
      return value.length > 0
    }

    return value !== undefined && value !== null && value !== false
  })

  return activeField ? ALWAYS_DYNAMIC_REQUEST_REASON_MAP[activeField] || null : null
}

function classifyUnsupportedTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return 'tool_invalid_payload'
  }

  const rawType = normalizeStringValue(tool.type)
  const sourceFunction = tool.function && typeof tool.function === 'object' ? tool.function : tool
  const toolName = normalizeStringValue(sourceFunction.name || tool.name)

  if (rawType === 'function' || (!rawType && toolName)) {
    return 'tool_invalid_function'
  }

  if (!rawType) {
    return 'tool_invalid_payload'
  }

  const normalizedType = String(rawType)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalizedType ? `tool_${normalizedType}` : 'tool_invalid_payload'
}

function getUnsupportedToolReason(requestBody = {}) {
  const { tools } = requestBody
  if (tools === undefined || tools === null) {
    return null
  }

  if (!Array.isArray(tools)) {
    return 'tool_invalid_payload'
  }

  const firstUnsupportedTool = tools.find((tool) => !isCacheSafeFunctionTool(tool))
  if (!firstUnsupportedTool) {
    return null
  }

  return classifyUnsupportedTool(firstUnsupportedTool)
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

function normalizeDiagnosticType(value) {
  const normalized = normalizeStringValue(value)
  if (!normalized) {
    return 'unknown'
  }

  return String(normalized)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function summarizeToolTypes(requestBody = {}) {
  if (!Array.isArray(requestBody.tools) || requestBody.tools.length === 0) {
    return []
  }

  return Array.from(
    new Set(
      requestBody.tools.map((tool) => {
        if (!tool || typeof tool !== 'object') {
          return 'invalid_payload'
        }

        const rawType = normalizeStringValue(tool.type)
        const sourceFunction =
          tool.function && typeof tool.function === 'object' ? tool.function : tool
        const toolName = normalizeStringValue(sourceFunction.name || tool.name)
        if (rawType === 'function' || (!rawType && toolName)) {
          return 'function'
        }

        return normalizeDiagnosticType(rawType || 'invalid_payload')
      })
    )
  )
}

function collectContentPartTypes(content, bucket = new Set()) {
  if (typeof content === 'string') {
    bucket.add('text')
    return bucket
  }

  if (Array.isArray(content)) {
    content.forEach((item) => collectContentPartTypes(item, bucket))
    return bucket
  }

  if (!content || typeof content !== 'object') {
    bucket.add('invalid')
    return bucket
  }

  const explicitType = normalizeDiagnosticType(content.type)
  if (explicitType !== 'unknown') {
    bucket.add(explicitType)
  }

  if (typeof content.input_text === 'string') {
    bucket.add('input_text')
  } else if (typeof content.output_text === 'string') {
    bucket.add('output_text')
  } else if (typeof content.text === 'string' || typeof content.content === 'string') {
    bucket.add('text')
  }

  if (content.image_url) {
    bucket.add('image_url')
  }

  if (content.image) {
    bucket.add('image')
  }

  if (content.input_image) {
    bucket.add('input_image')
  }

  return bucket
}

function summarizeInputShape(requestBody = {}) {
  const result = {
    inputContainer: 'none',
    inputItemKinds: [],
    inputRoles: [],
    contentPartTypes: []
  }

  const itemKinds = new Set()
  const roles = new Set()
  const contentPartTypes = new Set()

  const sourceItems = Array.isArray(requestBody.messages)
    ? requestBody.messages
    : Array.isArray(requestBody.input)
      ? requestBody.input
      : requestBody.input !== undefined && requestBody.input !== null
        ? [requestBody.input]
        : []

  if (Array.isArray(requestBody.messages)) {
    result.inputContainer = 'messages'
  } else if (Array.isArray(requestBody.input)) {
    result.inputContainer = 'input_array'
  } else if (typeof requestBody.input === 'string') {
    result.inputContainer = 'input_string'
  } else if (requestBody.input !== undefined && requestBody.input !== null) {
    result.inputContainer = 'input_single'
  }

  for (const item of sourceItems) {
    if (typeof item === 'string') {
      itemKinds.add('string')
      contentPartTypes.add('text')
      continue
    }

    if (!item || typeof item !== 'object') {
      itemKinds.add('invalid')
      continue
    }

    if (isMessageInputItem(item)) {
      itemKinds.add(normalizeDiagnosticType(item.type || 'message'))
      roles.add(mapMessageRole(item.role))
      collectContentPartTypes(item.content, contentPartTypes)
      continue
    }

    itemKinds.add(normalizeDiagnosticType(item.type || 'content_item'))
    collectContentPartTypes(item, contentPartTypes)
  }

  result.inputItemKinds = Array.from(itemKinds).sort()
  result.inputRoles = Array.from(roles).sort()
  result.contentPartTypes = Array.from(contentPartTypes).sort()
  return result
}

function buildCacheBypassSummary(requestBody = {}, options = {}) {
  const toolProfile = buildToolProfile(requestBody, {
    semanticSafeOnly: options.semanticSafeOnly === true
  })
  const inputShape = summarizeInputShape(requestBody)
  const summary = {
    topLevelKeys:
      requestBody && typeof requestBody === 'object' ? Object.keys(requestBody).sort() : [],
    hasTools: Array.isArray(requestBody.tools) && requestBody.tools.length > 0,
    toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0,
    toolTypes: summarizeToolTypes(requestBody),
    normalizedToolCount: Array.isArray(toolProfile.tools) ? toolProfile.tools.length : 0,
    toolChoiceMode: getToolChoiceMode(requestBody.tool_choice),
    parallelToolCalls:
      Array.isArray(requestBody.tools) && requestBody.tools.length > 0
        ? requestBody.parallel_tool_calls !== false
        : null,
    hasBackground: Boolean(requestBody.background),
    hasWebSearchOptions: Boolean(requestBody.web_search_options),
    structuredOutput: isStructuredOutputRequest(requestBody),
    inputContainer: inputShape.inputContainer,
    inputItemKinds: inputShape.inputItemKinds,
    inputRoles: inputShape.inputRoles,
    contentPartTypes: inputShape.contentPartTypes
  }

  return {
    ...summary,
    shapeHash: createHash(summary).slice(0, 16)
  }
}

function normalizeResponsesToolChoice(choice) {
  const normalizedChoice = normalizeToolChoice(choice)
  if (normalizedChoice === undefined) {
    return undefined
  }

  if (typeof normalizedChoice === 'string') {
    return normalizedChoice
  }

  if (normalizedChoice.type === 'function' && normalizedChoice.name) {
    return {
      type: 'function',
      name: normalizedChoice.name
    }
  }

  return normalizedChoice
}

function normalizeResponsesToolingRequest(requestBody = {}) {
  if (!requestBody || typeof requestBody !== 'object') {
    return {
      changed: false,
      body: requestBody
    }
  }

  let nextBody = requestBody
  let changed = false

  if (Array.isArray(requestBody.tools)) {
    const normalizedTools = requestBody.tools.map((tool) => toResponsesFunctionTool(tool) || tool)
    const toolsChanged = JSON.stringify(normalizedTools) !== JSON.stringify(requestBody.tools || [])

    if (toolsChanged) {
      nextBody = {
        ...nextBody,
        tools: normalizedTools
      }
      changed = true
    }
  }

  if (Object.prototype.hasOwnProperty.call(requestBody, 'tool_choice')) {
    const normalizedToolChoice = normalizeResponsesToolChoice(requestBody.tool_choice)
    const toolChoiceChanged =
      JSON.stringify(normalizedToolChoice) !== JSON.stringify(requestBody.tool_choice)

    if (toolChoiceChanged) {
      nextBody = {
        ...nextBody,
        tool_choice: normalizedToolChoice
      }
      changed = true
    }
  }

  return {
    changed,
    body: changed ? nextBody : requestBody
  }
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
      reason:
        getUnsupportedToolReason(requestBody) ||
        (semanticSafeOnly ? 'dynamic_request' : 'dynamic_tools')
    }
  }

  const choiceMode = getToolChoiceMode(requestBody.tool_choice)
  return {
    supported: true,
    hasTools: normalizedTools.length > 0,
    tools: normalizedTools,
    choiceMode,
    parallelToolCalls: normalizedTools.length > 0 ? requestBody.parallel_tool_calls !== false : null
  }
}

function normalizeCacheValue(value, parentKey = '') {
  if (value === undefined || value === null) {
    return undefined
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined
    }

    if (parentKey === 'tools') {
      const normalizedTools = normalizeToolDefinitions(value)
      return normalizedTools && normalizedTools.length > 0 ? normalizedTools : undefined
    }

    const normalizedItems = value
      .map((item) => normalizeCacheValue(item, parentKey))
      .filter((item) => item !== undefined)

    return normalizedItems.length > 0 ? normalizedItems : undefined
  }

  if (typeof value !== 'object') {
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

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeToolItemName(item, type) {
  const name = normalizeStringValue(item?.name || item?.tool_name || item?.function?.name || '')
  if (name) {
    return name
  }

  if (type.startsWith('web_search')) {
    return 'web_search'
  }

  if (type.endsWith('_call')) {
    return type.replace(/_call$/u, '')
  }

  return ''
}

function getStructuredInputPayload(item, type) {
  if (type.endsWith('_call_output')) {
    return item.output ?? item.result ?? item.response ?? item.content ?? item.text ?? ''
  }

  return item.arguments ?? item.input ?? item.query ?? item.content ?? item.text ?? ''
}

function formatStructuredInputLabel(type, name, options = {}) {
  const { semanticMode = false } = options
  if (!semanticMode) {
    return name ? `${type}:${name}` : type
  }

  const category = type
    .replace(/_call_output$/u, '')
    .replace(/_call$/u, '')
    .replace(/_/g, ' ')

  if (type.endsWith('_call_output')) {
    return name ? `${category} ${name} output` : `${category} output`
  }

  if (type.endsWith('_call')) {
    return name ? `${category} ${name} call` : `${category} call`
  }

  return name ? `${category} ${name}` : category
}

function extractStructuredInputItem(item, options = {}) {
  const { semanticMode = false } = options
  const type = normalizeDiagnosticType(item?.type || '')

  if (!type || type === 'unknown') {
    return { supported: false, reason: 'unsupported_input_item' }
  }

  if (type === 'reasoning') {
    return { supported: true, skip: true }
  }

  if (type === 'input_text' && typeof item.text === 'string') {
    return {
      supported: true,
      role: 'user',
      text: normalizeText(item.text)
    }
  }

  if ((type === 'output_text' || type === 'text') && (item.output_text || item.text)) {
    return {
      supported: true,
      role: 'assistant',
      text: normalizeText(item.output_text || item.text)
    }
  }

  if (type.endsWith('_call') || type.endsWith('_call_output')) {
    const name = normalizeToolItemName(item, type)
    const payload = stringifyNormalizedPayload(getStructuredInputPayload(item, type), {
      semanticMode,
      maxLength: type.endsWith('_call_output') ? 900 : 480
    })
    const label = formatStructuredInputLabel(type, name, { semanticMode })
    const text = normalizeText(payload ? `${label} ${payload}` : label)

    if (!text) {
      return { supported: true, skip: true }
    }

    return {
      supported: true,
      role: type.endsWith('_call_output') ? 'tool' : 'assistant',
      name: name || undefined,
      text
    }
  }

  const contentResult = extractTextFromContent(item)
  if (!contentResult.supported) {
    return { supported: false, reason: 'unsupported_input_item' }
  }

  return {
    supported: true,
    role: 'user',
    text: contentResult.text
  }
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

    const structuredItem = extractStructuredInputItem(item, { semanticMode })
    if (!structuredItem.supported) {
      return structuredItem
    }

    if (structuredItem.skip) {
      continue
    }

    appendCanonicalItem(
      items,
      structuredItem.role || 'user',
      normalizePromptText(structuredItem.text, {
        semanticMode,
        role: structuredItem.role || 'user'
      }),
      structuredItem.name
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
  tokenizeSemanticText,
  normalizeCacheValue,
  normalizeFunctionTool,
  toResponsesFunctionTool,
  normalizeToolDefinitions,
  normalizeToolChoice,
  normalizeResponsesToolChoice,
  normalizeResponsesToolingRequest,
  buildToolProfile,
  hasAlwaysDynamicFields,
  getAlwaysDynamicRequestReason,
  hasUnsafeToolDefinitions,
  getUnsupportedToolReason,
  isStructuredOutputRequest,
  mapMessageRole,
  isMessageInputItem,
  extractTextFromContent,
  extractUserTextsFromCanonicalRequest,
  buildCanonicalPrompt,
  buildSemanticQueryText,
  buildRecallTokens,
  buildCacheBypassSummary,
  isCodexCliBoilerplate,
  looksLikeLowSignalFollowUp,
  isCacheSafeFunctionTool,
  getToolChoiceMode
}
