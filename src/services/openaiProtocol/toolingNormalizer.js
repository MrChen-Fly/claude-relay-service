function normalizeText(text) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.replace(/\s+/g, ' ').trim()
}

function normalizeStringValue(value) {
  return typeof value === 'string' ? value.trim() : value
}

function normalizeScalarValue(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    return normalized || undefined
  }

  return value
}

function normalizeStructuredValue(value) {
  if (value === undefined || value === null) {
    return undefined
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizeStructuredValue(item))
      .filter((item) => item !== undefined)

    return normalizedItems.length > 0 ? normalizedItems : undefined
  }

  if (typeof value !== 'object') {
    return normalizeScalarValue(value)
  }

  const normalized = {}

  for (const key of Object.keys(value).sort()) {
    const normalizedValue = normalizeStructuredValue(value[key])
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * Normalizes a function-tool parameter schema for Responses upstream APIs.
 *
 * @param {object|undefined} parameters - Raw JSON schema.
 * @returns {object|undefined} Normalized schema payload.
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

/**
 * Normalizes an implicit or explicit function tool into a stable shape.
 *
 * @param {object} tool - Raw tool definition.
 * @returns {object|null} Normalized function tool or null.
 */
function normalizeFunctionTool(tool) {
  if (!tool || typeof tool !== 'object') {
    return null
  }

  const type = normalizeStringValue(tool.type)
  const sourceFunction = tool.function && typeof tool.function === 'object' ? tool.function : tool
  const name = normalizeStringValue(sourceFunction.name || tool.name)
  const normalizedType = type || (name ? 'function' : '')
  if (normalizedType !== 'function' || !name) {
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
    normalizeStructuredValue(sourceFunction.parameters || tool.parameters)
  )
  if (parameters && typeof parameters === 'object' && Object.keys(parameters).length > 0) {
    normalizedTool.function.parameters = parameters
  }

  if (typeof sourceFunction.strict === 'boolean') {
    normalizedTool.function.strict = sourceFunction.strict
  }

  return normalizedTool
}

/**
 * Normalizes tool choice payloads from Chat/Responses clients.
 *
 * @param {string|object|undefined} choice - Raw tool_choice value.
 * @param {object} [options] - Normalization options.
 * @param {boolean} [options.omitAuto=false] - Drop `auto` when requested.
 * @returns {string|object|undefined} Normalized tool choice.
 */
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
    return choice
  }

  const normalizedType = normalizeStringValue(choice.type || '')
  const normalizedName = normalizeStringValue(choice.name || choice.function?.name || '')

  if ((normalizedType === 'function' || !normalizedType) && normalizedName) {
    return {
      type: 'function',
      name: normalizedName
    }
  }

  const normalized = normalizeStructuredValue(choice)
  if (!normalized) {
    return undefined
  }

  if (omitAuto && normalized.type === 'auto') {
    return undefined
  }

  return normalized
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

/**
 * Normalizes Responses request tooling fields before upstream relay.
 *
 * @param {object} requestBody - Raw Responses request body.
 * @returns {{changed: boolean, body: object}} Normalized body metadata.
 */
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

module.exports = {
  normalizeFunctionTool,
  normalizeResponsesToolingRequest,
  normalizeToolChoice
}
