const { extractUserTextsFromCanonicalRequest } = require('../openaiCacheCanonicalizer')

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(1, value))
}

function cosineSimilarity(vectorA = [], vectorB = []) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length !== vectorB.length) {
    return 0
  }

  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0

  for (let index = 0; index < vectorA.length; index += 1) {
    const valueA = Number(vectorA[index]) || 0
    const valueB = Number(vectorB[index]) || 0
    dotProduct += valueA * valueB
    magnitudeA += valueA * valueA
    magnitudeB += valueB * valueB
  }

  if (!magnitudeA || !magnitudeB) {
    return 0
  }

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}

function getTextLengthRatio(left = '', right = '') {
  const leftLength = typeof left === 'string' ? left.length : 0
  const rightLength = typeof right === 'string' ? right.length : 0
  if (!leftLength || !rightLength) {
    return 0
  }

  return Math.min(leftLength, rightLength) / Math.max(leftLength, rightLength)
}

function tokenizeText(text = '') {
  if (typeof text !== 'string') {
    return []
  }

  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter(Boolean)
}

function getTokenOverlapScore(left = '', right = '') {
  const leftTokens = new Set(tokenizeText(left))
  const rightTokens = new Set(tokenizeText(right))

  if (!leftTokens.size || !rightTokens.size) {
    return 0
  }

  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1
    }
  }

  const unionSize = leftTokens.size + rightTokens.size - intersection
  return unionSize > 0 ? intersection / unionSize : 0
}

function getRecencyScore(createdAt) {
  if (!createdAt) {
    return 0
  }

  const createdAtMs = new Date(createdAt).getTime()
  if (!Number.isFinite(createdAtMs)) {
    return 0
  }

  const ageHours = Math.max(0, (Date.now() - createdAtMs) / 3600000)
  return clampScore(1 - ageHours / 720)
}

function getContextAlignment(plan = {}, candidate = {}) {
  const candidateFingerprint =
    candidate.contextFingerprint || candidate.meta?.contextFingerprint || null

  if (!plan.contextFingerprint || !candidateFingerprint) {
    return 0
  }

  return plan.contextFingerprint === candidateFingerprint ? 1 : -1
}

function getRecentUserTurns(text = '', limit = 3) {
  if (typeof text !== 'string' || !text.trim()) {
    return []
  }

  return extractUserTextsFromCanonicalRequest(text).slice(-limit)
}

function reweightSequenceWeights(weights = [], length = 0) {
  const activeWeights = weights.slice(0, length)
  const totalWeight = activeWeights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0) {
    return activeWeights.map(() => 0)
  }

  return activeWeights.map((weight) => weight / totalWeight)
}

function getSequenceTurnMatchScore(left = '', right = '') {
  if (!left || !right) {
    return 0
  }

  const normalizedLeft = left.trim().toLowerCase()
  const normalizedRight = right.trim().toLowerCase()
  if (normalizedLeft && normalizedLeft === normalizedRight) {
    return 1
  }

  return clampScore(getTokenOverlapScore(left, right) * 0.75 + getTextLengthRatio(left, right) * 0.25)
}

function getSequenceMatchScore(currentRequestText = '', candidateRequestText = '') {
  const currentTurns = getRecentUserTurns(currentRequestText)
  const candidateTurns = getRecentUserTurns(candidateRequestText)
  const length = Math.min(currentTurns.length, candidateTurns.length, 3)

  if (length < 2) {
    return 0
  }

  const weights = reweightSequenceWeights([0.58, 0.3, 0.12], length)
  let score = 0

  for (let index = 0; index < length; index += 1) {
    const currentTurn = currentTurns[currentTurns.length - 1 - index]
    const candidateTurn = candidateTurns[candidateTurns.length - 1 - index]
    score += getSequenceTurnMatchScore(currentTurn, candidateTurn) * weights[index]
  }

  return clampScore(score)
}

function evaluateCandidate({
  plan = {},
  queryEmbedding = [],
  entry = {},
  entryKey,
  embedding = []
}) {
  const similarity = cosineSimilarity(queryEmbedding, embedding)
  const focalText = entry.requestFocalText || getRecentUserTurns(entry.requestText, 1)[0] || entry.requestText || ''
  const focalLengthRatio = getTextLengthRatio(plan.queryText, focalText)
  const fullLengthRatio = getTextLengthRatio(plan.requestText || plan.queryText, entry.requestText)
  const focalOverlapScore = getTokenOverlapScore(plan.queryText, focalText)
  const recencyScore = getRecencyScore(entry.meta?.createdAt)
  const contextAlignment = getContextAlignment(plan, entry)
  const sequenceMatchScore = getSequenceMatchScore(
    plan.requestText || plan.queryText,
    entry.requestText || focalText
  )

  let score =
    similarity * 0.75 +
    focalLengthRatio * 0.05 +
    fullLengthRatio * 0.04 +
    focalOverlapScore * 0.05 +
    recencyScore * 0.02 +
    sequenceMatchScore * 0.06
  score += contextAlignment * 0.03

  if (entry.provider && plan.provider && entry.provider !== plan.provider) {
    score -= 0.05
  }

  if (entry.endpoint && plan.endpoint && entry.endpoint !== plan.endpoint) {
    score -= 0.05
  }

  if (entry.model && plan.model && entry.model !== plan.model) {
    score -= 0.2
  }

  score = clampScore(score)

  const hasContextConflict = contextAlignment < 0 && sequenceMatchScore < 0.45
  const strictSimilarityFloor = Math.max((plan.similarityThreshold || 0.95) + 0.02, 0.98)
  const accepted =
    similarity >= (plan.similarityThreshold || 0.95) &&
    score >= (plan.rankAcceptanceThreshold || 0.9) &&
    (!hasContextConflict || similarity >= strictSimilarityFloor)

  return {
    entry,
    entryKey,
    similarity,
    score,
    accepted,
    hasContextConflict,
    factors: {
      focalLengthRatio,
      fullLengthRatio,
      focalOverlapScore,
      recencyScore,
      contextAlignment,
      sequenceMatchScore
    }
  }
}

function rankCandidates({ plan = {}, queryEmbedding = [], candidates = [] }) {
  const ranked = candidates
    .map((candidate) =>
      evaluateCandidate({
        plan,
        queryEmbedding,
        entry: candidate.entry,
        entryKey: candidate.entryKey,
        embedding: candidate.embedding
      })
    )
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.similarity - left.similarity
    })

  return {
    ranked,
    accepted: ranked.find((candidate) => candidate.accepted) || null,
    best: ranked[0] || null
  }
}

module.exports = {
  cosineSimilarity,
  evaluateCandidate,
  rankCandidates
}
