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

function evaluateCandidate({
  plan = {},
  queryEmbedding = [],
  entry = {},
  entryKey,
  embedding = []
}) {
  const similarity = cosineSimilarity(queryEmbedding, embedding)
  const lengthRatio = getTextLengthRatio(plan.queryText, entry.requestText)
  const recencyScore = getRecencyScore(entry.meta?.createdAt)
  const contextAlignment = getContextAlignment(plan, entry)

  let score = similarity * 0.86 + lengthRatio * 0.07 + recencyScore * 0.04
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

  const hasContextConflict = contextAlignment < 0
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
      lengthRatio,
      recencyScore,
      contextAlignment
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
