const axios = require('axios')

const DEFAULT_MODEL_INFO_TTL_MS = 6 * 60 * 60 * 1000
const SAFE_TOKEN_LIMIT_RATIO = 0.9
const SAFE_CHARS_PER_TOKEN = 3.5

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeModelId(modelId = '') {
  return String(modelId || '').trim()
}

function resolveKnownEmbeddingModelTokenLimit(modelId = '') {
  const normalizedModelId = normalizeModelId(modelId)
  if (!normalizedModelId) {
    return 0
  }

  if (/^Qwen\/Qwen3-Embedding-(8B|4B|0\.6B)$/i.test(normalizedModelId)) {
    return 32768
  }

  if (/^(?:Pro\/)?BAAI\/bge-m3$/i.test(normalizedModelId)) {
    return 8192
  }

  return 0
}

function estimateMaxInputCharsFromTokenLimit(tokenLimit = 0) {
  const normalizedTokenLimit = toPositiveInteger(tokenLimit)
  if (!normalizedTokenLimit) {
    return 0
  }

  const safeTokenBudget = Math.max(1, Math.floor(normalizedTokenLimit * SAFE_TOKEN_LIMIT_RATIO))
  return Math.max(1, Math.floor(safeTokenBudget * SAFE_CHARS_PER_TOKEN))
}

class EmbeddingModelInfoResolver {
  constructor(options = {}) {
    this.apiKey = options.apiKey || ''
    this.baseUrl = String(options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.timeout = toPositiveInteger(options.timeout) || 30000
    this.ttlMs = toPositiveInteger(options.ttlMs) || DEFAULT_MODEL_INFO_TTL_MS
    this.cache = new Map()
  }

  async _fetchModelCatalog() {
    if (!this.apiKey) {
      return []
    }

    const response = await axios.get(`${this.baseUrl}/models`, {
      timeout: this.timeout,
      headers: {
        Authorization: `Bearer ${this.apiKey}`
      }
    })

    return Array.isArray(response.data?.data) ? response.data.data : []
  }

  async resolve(modelId = '') {
    const normalizedModelId = normalizeModelId(modelId)
    if (!normalizedModelId) {
      return null
    }

    const cached = this.cache.get(normalizedModelId)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    let matchedModel = null
    let source = 'known_limit_map'
    try {
      const catalog = await this._fetchModelCatalog()
      matchedModel =
        catalog.find((item) => normalizeModelId(item?.id) === normalizedModelId) || null
      if (matchedModel) {
        source = 'models_api+known_limit_map'
      }
    } catch (_) {
      source = 'known_limit_map'
    }

    const tokenLimit = resolveKnownEmbeddingModelTokenLimit(normalizedModelId)
    const value = {
      id: normalizedModelId,
      found: Boolean(matchedModel),
      tokenLimit,
      recommendedMaxInputChars: estimateMaxInputCharsFromTokenLimit(tokenLimit),
      source
    }

    this.cache.set(normalizedModelId, {
      value,
      expiresAt: Date.now() + this.ttlMs
    })

    return value
  }
}

module.exports = {
  EmbeddingModelInfoResolver,
  resolveKnownEmbeddingModelTokenLimit,
  estimateMaxInputCharsFromTokenLimit
}
