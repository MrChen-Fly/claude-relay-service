const DEFAULT_LONG_PROMPT_THRESHOLD_CHARS = 12000
const DEFAULT_EXCERPT_CHARS = 320
const DEFAULT_STRUCTURED_TOKEN_LIMIT = 12

function normalizeVerificationText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLongVerificationText(value, threshold = DEFAULT_LONG_PROMPT_THRESHOLD_CHARS) {
  return normalizeVerificationText(value).length >= threshold
}

function extractStructuredTokens(text, limit = DEFAULT_STRUCTURED_TOKEN_LIMIT) {
  const matches = normalizeVerificationText(text).match(/[A-Za-z0-9._:/\\-]{5,80}/g) || []
  const seen = new Set()
  const tokens = []

  for (const candidate of matches) {
    if (!/[0-9]/.test(candidate) && !/[/:\\_-]/.test(candidate)) {
      continue
    }

    const normalizedCandidate = candidate.toLowerCase()
    if (seen.has(normalizedCandidate)) {
      continue
    }

    seen.add(normalizedCandidate)
    tokens.push(candidate)
    if (tokens.length >= limit) {
      break
    }
  }

  return tokens
}

function buildExcerptDescriptors(normalizedText, excerptChars = DEFAULT_EXCERPT_CHARS) {
  if (!normalizedText) {
    return []
  }

  if (normalizedText.length <= excerptChars) {
    return [{ label: 'head', text: normalizedText }]
  }

  const maxStart = Math.max(0, normalizedText.length - excerptChars)
  const rawStarts = [
    0,
    Math.max(0, Math.floor(normalizedText.length / 2 - excerptChars / 2)),
    maxStart
  ]
  const starts = [...new Set(rawStarts.map((value) => Math.max(0, Math.min(value, maxStart))))]
  const labels = starts.length === 2 ? ['head', 'tail'] : ['head', 'middle', 'tail']

  return starts.map((start, index) => ({
    label: labels[index] || `excerpt_${index + 1}`,
    text: normalizedText.slice(start, start + excerptChars)
  }))
}

function buildSemanticVerificationText(value, options = {}) {
  const threshold =
    Number.parseInt(options.longPromptThresholdChars, 10) || DEFAULT_LONG_PROMPT_THRESHOLD_CHARS
  const excerptChars = Number.parseInt(options.excerptChars, 10) || DEFAULT_EXCERPT_CHARS
  const structuredTokenLimit =
    Number.parseInt(options.structuredTokenLimit, 10) || DEFAULT_STRUCTURED_TOKEN_LIMIT
  const normalizedText = normalizeVerificationText(value)

  if (!normalizedText) {
    return ''
  }

  if (!isLongVerificationText(normalizedText, threshold)) {
    return normalizedText
  }

  const structuredTokens = extractStructuredTokens(normalizedText, structuredTokenLimit)
  const excerpts = buildExcerptDescriptors(normalizedText, excerptChars)
  const lines = ['[LONG PROMPT SUMMARY]', `chars=${normalizedText.length}`]

  lines.push(
    structuredTokens.length > 0
      ? `structured_tokens=${structuredTokens.join(', ')}`
      : 'structured_tokens=(none)'
  )

  for (const excerpt of excerpts) {
    lines.push(`${excerpt.label}_excerpt=${JSON.stringify(excerpt.text)}`)
  }

  return lines.join('\n')
}

module.exports = {
  DEFAULT_LONG_PROMPT_THRESHOLD_CHARS,
  buildSemanticVerificationText,
  isLongVerificationText,
  normalizeVerificationText
}
