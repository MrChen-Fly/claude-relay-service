const CODEX_CLI_PROMPT_PREFIX =
  "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer."

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

  return {
    supported: true,
    items,
    text: items.map((item) => `${item.role}: ${item.text}`).join('\n')
  }
}

module.exports = {
  normalizeText,
  mapMessageRole,
  isMessageInputItem,
  extractTextFromContent,
  buildCanonicalPrompt,
  isCodexCliBoilerplate
}
