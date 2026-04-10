const DEFAULT_LONG_PROMPT_THRESHOLD_CHARS = 12000
const DEFAULT_EXCERPT_CHARS = 320
const DEFAULT_EXCERPT_COUNT = 5
const DEFAULT_STRUCTURED_TOKEN_LIMIT = 16
const DEFAULT_MIN_LENGTH_RATIO = 0.7
const DEFAULT_MIN_STRUCTURED_TOKEN_OVERLAP = 0.5
const DEFAULT_MIN_EXCERPT_SIMILARITY = 0.55
const STOP_WORDS = new Set([
  'about',
  'after',
  'before',
  'final',
  'first',
  'focus',
  'from',
  'into',
  'make',
  'note',
  'overall',
  'please',
  'prompt',
  'repeat',
  'repeats',
  'segment',
  'should',
  'summary',
  'that',
  'this',
  'validation',
  'validates',
  'variant',
  'while',
  'with',
  'without'
])

function normalizeVerificationText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLongVerificationText(value, threshold = DEFAULT_LONG_PROMPT_THRESHOLD_CHARS) {
  return normalizeVerificationText(value).length >= threshold
}

function isStructuredAnchorToken(candidate) {
  const normalizedCandidate = String(candidate || '').toLowerCase()
  if (!normalizedCandidate || STOP_WORDS.has(normalizedCandidate)) {
    return false
  }

  if (/^\d+$/.test(normalizedCandidate)) {
    return normalizedCandidate.length >= 6
  }

  if (/^[a-f0-9]{8,}$/i.test(normalizedCandidate)) {
    return true
  }

  if (/[\\/]/.test(normalizedCandidate)) {
    return true
  }

  if (/^v?\d+(?:\.\d+){1,3}$/i.test(normalizedCandidate)) {
    return true
  }

  return (
    normalizedCandidate.length >= 8 &&
    /[a-z]/i.test(normalizedCandidate) &&
    /[0-9]/.test(normalizedCandidate)
  )
}

function extractStructuredTokens(text, limit = DEFAULT_STRUCTURED_TOKEN_LIMIT) {
  const matches = normalizeVerificationText(text).match(/[A-Za-z0-9._:/\\-]{5,80}/g) || []
  const seen = new Set()
  const tokens = []

  for (const candidate of matches) {
    if (!isStructuredAnchorToken(candidate)) {
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

function buildExcerptDescriptors(
  normalizedText,
  excerptChars = DEFAULT_EXCERPT_CHARS,
  excerptCount = DEFAULT_EXCERPT_COUNT
) {
  if (!normalizedText) {
    return []
  }

  if (normalizedText.length <= excerptChars) {
    return [{ label: 'head', text: normalizedText }]
  }

  const maxStart = Math.max(0, normalizedText.length - excerptChars)
  const normalizedExcerptCount = Math.max(2, Number.parseInt(excerptCount, 10) || 3)
  const rawStarts = Array.from({ length: normalizedExcerptCount }, (_, index) => {
    if (normalizedExcerptCount === 1) {
      return 0
    }

    const ratio = index / (normalizedExcerptCount - 1)
    return Math.round(maxStart * ratio)
  })
  const starts = [...new Set(rawStarts.map((value) => Math.max(0, Math.min(value, maxStart))))]
  const labels = starts.map((_, index) => {
    if (index === 0) {
      return 'head'
    }

    if (index === starts.length - 1) {
      return 'tail'
    }

    if (starts.length % 2 === 1 && index === Math.floor(starts.length / 2)) {
      return 'middle'
    }

    return `excerpt_${index + 1}`
  })

  return starts.map((start, index) => ({
    label: labels[index] || `excerpt_${index + 1}`,
    text: normalizedText.slice(start, start + excerptChars)
  }))
}

function tokenizeExcerpt(text) {
  const matches =
    normalizeVerificationText(text)
      .toLowerCase()
      .match(/[a-z0-9]{4,}/g) || []
  return new Set(matches.filter((token) => !STOP_WORDS.has(token)))
}

function calculateTokenOverlap(leftTokens = [], rightTokens = []) {
  if (!Array.isArray(leftTokens) || !Array.isArray(rightTokens)) {
    return 0
  }

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 1
  }

  const rightTokenSet = new Set(rightTokens.map((token) => String(token).toLowerCase()))
  const overlapCount = leftTokens.filter((token) =>
    rightTokenSet.has(String(token).toLowerCase())
  ).length

  return overlapCount / Math.min(leftTokens.length, rightTokens.length)
}

function calculateExcerptSimilarity(leftExcerpts = [], rightExcerpts = []) {
  if (!Array.isArray(leftExcerpts) || !Array.isArray(rightExcerpts)) {
    return 0
  }

  const pairCount = Math.min(leftExcerpts.length, rightExcerpts.length)
  if (pairCount === 0) {
    return 1
  }

  let totalSimilarity = 0
  for (let index = 0; index < pairCount; index += 1) {
    const leftTokens = tokenizeExcerpt(leftExcerpts[index]?.text)
    const rightTokens = tokenizeExcerpt(rightExcerpts[index]?.text)
    if (leftTokens.size === 0 && rightTokens.size === 0) {
      totalSimilarity += 1
      continue
    }

    const union = new Set([...leftTokens, ...rightTokens])
    let intersectionCount = 0
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        intersectionCount += 1
      }
    }

    totalSimilarity += union.size === 0 ? 1 : intersectionCount / union.size
  }

  return totalSimilarity / pairCount
}

function buildLongPromptFingerprint(value, options = {}) {
  const excerptChars = Number.parseInt(options.excerptChars, 10) || DEFAULT_EXCERPT_CHARS
  const excerptCount = Number.parseInt(options.excerptCount, 10) || DEFAULT_EXCERPT_COUNT
  const structuredTokenLimit =
    Number.parseInt(options.structuredTokenLimit, 10) || DEFAULT_STRUCTURED_TOKEN_LIMIT
  const normalizedText = normalizeVerificationText(value)

  return {
    normalizedText,
    charCount: normalizedText.length,
    structuredTokens: extractStructuredTokens(normalizedText, structuredTokenLimit),
    excerpts: buildExcerptDescriptors(normalizedText, excerptChars, excerptCount)
  }
}

function evaluateLongPromptCompatibility(leftValue, rightValue, options = {}) {
  const minLengthRatio = Number.parseFloat(options.minLengthRatio) || DEFAULT_MIN_LENGTH_RATIO
  const minStructuredTokenOverlap =
    Number.parseFloat(options.minStructuredTokenOverlap) || DEFAULT_MIN_STRUCTURED_TOKEN_OVERLAP
  const minExcerptSimilarity =
    Number.parseFloat(options.minExcerptSimilarity) || DEFAULT_MIN_EXCERPT_SIMILARITY
  const leftFingerprint = buildLongPromptFingerprint(leftValue, options)
  const rightFingerprint = buildLongPromptFingerprint(rightValue, options)
  const maxLength = Math.max(leftFingerprint.charCount, rightFingerprint.charCount, 1)
  const lengthRatio = Math.min(leftFingerprint.charCount, rightFingerprint.charCount) / maxLength
  const structuredTokenOverlap = calculateTokenOverlap(
    leftFingerprint.structuredTokens,
    rightFingerprint.structuredTokens
  )
  const excerptSimilarity = calculateExcerptSimilarity(
    leftFingerprint.excerpts,
    rightFingerprint.excerpts
  )

  if (lengthRatio < minLengthRatio) {
    return {
      accepted: false,
      reason: 'length_ratio',
      lengthRatio,
      structuredTokenOverlap,
      excerptSimilarity,
      leftFingerprint,
      rightFingerprint
    }
  }

  if (
    leftFingerprint.structuredTokens.length > 0 &&
    rightFingerprint.structuredTokens.length > 0 &&
    structuredTokenOverlap < minStructuredTokenOverlap
  ) {
    return {
      accepted: false,
      reason: 'structured_tokens',
      lengthRatio,
      structuredTokenOverlap,
      excerptSimilarity,
      leftFingerprint,
      rightFingerprint
    }
  }

  if (excerptSimilarity < minExcerptSimilarity) {
    return {
      accepted: false,
      reason: 'excerpt_similarity',
      lengthRatio,
      structuredTokenOverlap,
      excerptSimilarity,
      leftFingerprint,
      rightFingerprint
    }
  }

  return {
    accepted: true,
    reason: '',
    lengthRatio,
    structuredTokenOverlap,
    excerptSimilarity,
    leftFingerprint,
    rightFingerprint
  }
}

function buildSemanticVerificationText(value, options = {}) {
  const threshold =
    Number.parseInt(options.longPromptThresholdChars, 10) || DEFAULT_LONG_PROMPT_THRESHOLD_CHARS
  const excerptChars = Number.parseInt(options.excerptChars, 10) || DEFAULT_EXCERPT_CHARS
  const excerptCount = Number.parseInt(options.excerptCount, 10) || DEFAULT_EXCERPT_COUNT
  const structuredTokenLimit =
    Number.parseInt(options.structuredTokenLimit, 10) || DEFAULT_STRUCTURED_TOKEN_LIMIT
  const fingerprint = buildLongPromptFingerprint(value, {
    excerptChars,
    excerptCount,
    structuredTokenLimit
  })
  const { normalizedText, structuredTokens, excerpts } = fingerprint

  if (!normalizedText) {
    return ''
  }

  if (!isLongVerificationText(normalizedText, threshold)) {
    return normalizedText
  }

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
  DEFAULT_EXCERPT_COUNT,
  DEFAULT_LONG_PROMPT_THRESHOLD_CHARS,
  buildSemanticVerificationText,
  buildLongPromptFingerprint,
  evaluateLongPromptCompatibility,
  isLongVerificationText,
  normalizeVerificationText
}
