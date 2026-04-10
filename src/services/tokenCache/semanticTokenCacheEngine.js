const logger = require('../../utils/logger')
const EmbeddingAnnIndex = require('./embeddingAnnIndex')
const {
  DEFAULT_LONG_PROMPT_THRESHOLD_CHARS,
  buildSemanticVerificationText,
  evaluateLongPromptCompatibility,
  isLongVerificationText,
  normalizeVerificationText
} = require('./semanticVerificationText')
const { cosineSimilarity } = require('./vector')

function normalizeThresholds(options = {}) {
  const highThreshold = Number(options.highThreshold) || 0.7
  const lowThreshold = Number(options.lowThreshold) || 0.3

  if (highThreshold <= lowThreshold) {
    return {
      highThreshold: 0.7,
      lowThreshold: 0.3
    }
  }

  return {
    highThreshold,
    lowThreshold
  }
}

class SemanticTokenCacheEngine {
  constructor(storage, provider, options = {}) {
    this.storage = storage
    this.provider = provider
    this.metrics = options.metrics || null
    const thresholds = normalizeThresholds(options)
    this.highThreshold = thresholds.highThreshold
    this.lowThreshold = thresholds.lowThreshold
    this.enableGrayZoneVerifier = options.enableGrayZoneVerifier !== false
    this.useANNIndex = options.useANNIndex !== false
    this.longPromptThresholdChars =
      Number.parseInt(options.longPromptThresholdChars, 10) || DEFAULT_LONG_PROMPT_THRESHOLD_CHARS
    this.indexes = new Map()
    this.indexWarmupPromise = this._warmIndexes()
  }

  isEnabled() {
    return Boolean(this.provider?.isEnabled?.())
  }

  _recordMetrics(fields = {}) {
    if (!this.metrics?.recordAsync) {
      return
    }

    this.metrics.recordAsync(fields)
  }

  _parseEmbeddingStorageKey(storageKey = '') {
    const normalizedKey = String(storageKey || '')
    const match = normalizedKey.match(/(?:^|:)embedding:([^:]+):([^:]+)$/)
    if (!match) {
      return null
    }

    return {
      scopeKey: match[1],
      cacheKey: match[2]
    }
  }

  _getScopeIndex(scopeKey) {
    if (!scopeKey) {
      return null
    }

    if (!this.indexes.has(scopeKey)) {
      this.indexes.set(scopeKey, new EmbeddingAnnIndex())
    }

    return this.indexes.get(scopeKey)
  }

  async _warmIndexes() {
    if (!this.useANNIndex || typeof this.storage?.getAllEmbeddingEntries !== 'function') {
      return
    }

    try {
      const storedEmbeddings = await this.storage.getAllEmbeddingEntries()
      if (!storedEmbeddings || storedEmbeddings.size === 0) {
        return
      }

      for (const [storageKey, embedding] of storedEmbeddings.entries()) {
        const parsedKey = this._parseEmbeddingStorageKey(storageKey)
        if (!parsedKey || !Array.isArray(embedding) || embedding.length === 0) {
          continue
        }

        this._getScopeIndex(parsedKey.scopeKey)?.add(storageKey, embedding)
      }
    } catch (error) {
      logger.warn('Token cache ANN index warmup failed', {
        message: error.message
      })
    }
  }

  async _findBestEmbeddingMatch(scopeKey, queryEmbedding) {
    if (this.useANNIndex) {
      await this.indexWarmupPromise

      const scopeIndex = this.indexes.get(scopeKey)
      if (scopeIndex && scopeIndex.size() > 0) {
        const { keys, distances } = scopeIndex.search(queryEmbedding, 1)
        if (keys.length > 0) {
          const bestKey = keys[0]
          const indexedVector = scopeIndex.getVector(bestKey)
          const bestSimilarity = indexedVector
            ? cosineSimilarity(queryEmbedding, indexedVector)
            : 1 - distances[0]

          return {
            bestKey,
            bestSimilarity
          }
        }
      }
    }

    const storedEmbeddings = await this.storage.getAllEmbeddings(scopeKey)
    if (!storedEmbeddings || storedEmbeddings.size === 0) {
      return null
    }

    let bestKey = ''
    let bestSimilarity = 0

    for (const [storageKey, embedding] of storedEmbeddings.entries()) {
      const similarity = cosineSimilarity(queryEmbedding, embedding)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestKey = storageKey
      }
    }

    if (!bestKey) {
      return null
    }

    return {
      bestKey,
      bestSimilarity
    }
  }

  _isLongPromptVerificationRequired(promptText, originalPrompt) {
    return (
      isLongVerificationText(promptText, this.longPromptThresholdChars) ||
      isLongVerificationText(originalPrompt, this.longPromptThresholdChars)
    )
  }

  _isEquivalentPromptText(promptText, originalPrompt) {
    return normalizeVerificationText(promptText) === normalizeVerificationText(originalPrompt)
  }

  _buildRejectedResult(reason, score, cacheKey, layer = 'semantic') {
    return {
      rejectedReason: reason,
      score,
      candidateCacheKey: cacheKey,
      layer
    }
  }

  _evaluateLongPromptCandidate(promptText, originalPrompt) {
    return evaluateLongPromptCompatibility(promptText, originalPrompt, {
      longPromptThresholdChars: this.longPromptThresholdChars
    })
  }

  async _verifyPromptSimilarity(promptText, originalPrompt) {
    if (!promptText || !originalPrompt || typeof this.provider?.checkSimilarity !== 'function') {
      return false
    }

    if (this._isEquivalentPromptText(promptText, originalPrompt)) {
      return true
    }

    const requiresLongVerification = this._isLongPromptVerificationRequired(
      promptText,
      originalPrompt
    )
    const verificationPromptText = requiresLongVerification
      ? buildSemanticVerificationText(promptText, {
          longPromptThresholdChars: this.longPromptThresholdChars
        })
      : promptText
    const verificationOriginalPrompt = requiresLongVerification
      ? buildSemanticVerificationText(originalPrompt, {
          longPromptThresholdChars: this.longPromptThresholdChars
        })
      : originalPrompt

    return this.provider.checkSimilarity(verificationPromptText, verificationOriginalPrompt)
  }

  async findSimilar({ scopeKey, promptText }) {
    if (!this.isEnabled() || !scopeKey || !promptText) {
      return null
    }

    const queryEmbedding = await this.provider.embed(promptText)
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return null
    }

    const bestMatch = await this._findBestEmbeddingMatch(scopeKey, queryEmbedding)
    if (!bestMatch?.bestKey) {
      return null
    }

    const { bestKey, bestSimilarity } = bestMatch
    const cacheKey = bestKey.split(':').pop()
    if (!cacheKey) {
      return null
    }

    const originalPrompt =
      bestSimilarity >= this.highThreshold ||
      (bestSimilarity >= this.lowThreshold && this.enableGrayZoneVerifier)
        ? await this.storage.getPrompt(cacheKey)
        : ''

    if (bestSimilarity >= this.highThreshold) {
      if (!originalPrompt) {
        return isLongVerificationText(promptText, this.longPromptThresholdChars)
          ? null
          : {
              cacheKey,
              score: bestSimilarity,
              layer: 'semantic'
            }
      }

      const requiresLongVerification = this._isLongPromptVerificationRequired(
        promptText,
        originalPrompt
      )
      if (requiresLongVerification && !this._isEquivalentPromptText(promptText, originalPrompt)) {
        const longPromptGate = this._evaluateLongPromptCandidate(promptText, originalPrompt)
        if (!longPromptGate.accepted) {
          return this._buildRejectedResult(
            `long_prompt_local_gate_${longPromptGate.reason}`,
            bestSimilarity,
            cacheKey
          )
        }

        const verified = await this._verifyPromptSimilarity(promptText, originalPrompt)
        if (!verified) {
          return this._buildRejectedResult(
            'long_prompt_verifier_reject',
            bestSimilarity,
            cacheKey,
            'semantic_verified'
          )
        }

        return {
          cacheKey,
          score: bestSimilarity,
          layer: 'semantic_verified'
        }
      }

      return {
        cacheKey,
        score: bestSimilarity,
        layer: 'semantic'
      }
    }

    if (bestSimilarity < this.lowThreshold) {
      return null
    }

    this._recordMetrics({
      grayZoneChecks: 1
    })

    if (!this.enableGrayZoneVerifier) {
      return null
    }

    if (!originalPrompt) {
      return null
    }

    const requiresLongVerification = this._isLongPromptVerificationRequired(
      promptText,
      originalPrompt
    )
    if (requiresLongVerification) {
      const longPromptGate = this._evaluateLongPromptCandidate(promptText, originalPrompt)
      if (!longPromptGate.accepted) {
        return this._buildRejectedResult(
          `long_prompt_local_gate_${longPromptGate.reason}`,
          bestSimilarity,
          cacheKey
        )
      }
    }

    const verified = await this._verifyPromptSimilarity(promptText, originalPrompt)
    if (!verified) {
      return this._buildRejectedResult(
        requiresLongVerification ? 'long_prompt_verifier_reject' : 'semantic_verifier_reject',
        bestSimilarity,
        cacheKey,
        'semantic_verified'
      )
    }

    return {
      cacheKey,
      score: bestSimilarity,
      layer: 'semantic_verified'
    }
  }

  async store({ scopeKey, cacheKey, promptText, ttlSeconds }) {
    if (!this.isEnabled() || !scopeKey || !cacheKey || !promptText) {
      return null
    }

    await this.storage.set('prompt', cacheKey, { promptText }, ttlSeconds)

    const embedding = await this.provider.embed(promptText)
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return null
    }

    const storageKey = `${scopeKey}:${cacheKey}`
    await this.storage.set('embedding', storageKey, embedding, ttlSeconds)
    if (this.useANNIndex) {
      this._getScopeIndex(scopeKey)?.add(`embedding:${storageKey}`, embedding)
    }

    return {
      stored: true,
      layer: 'semantic'
    }
  }
}

module.exports = SemanticTokenCacheEngine
