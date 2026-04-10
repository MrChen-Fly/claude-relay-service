const redis = require('../../models/redis')

class RedisTokenCacheStorage {
  constructor(options = {}) {
    this.namespace = options.namespace || 'token_cache:openai_responses'
  }

  _buildKey(kind, key) {
    return `${this.namespace}:${kind}:${key}`
  }

  async set(kind, key, value, ttlSeconds = 0) {
    const storageKey = this._buildKey(kind, key)
    const payload = typeof value === 'string' ? value : JSON.stringify(value)

    if (ttlSeconds > 0) {
      await redis.setex(storageKey, ttlSeconds, payload)
      return
    }

    await redis.set(storageKey, payload)
  }

  async get(kind, key) {
    const storageKey = this._buildKey(kind, key)
    const raw = await redis.get(storageKey)
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw)
    } catch (_) {
      return raw
    }
  }

  _parseRawValue(raw) {
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw)
    } catch (_) {
      return raw
    }
  }

  async delete(key) {
    const embeddingKeys = await redis.scanKeys(this._buildKey('embedding', `*:${key}`))

    await redis.del(this._buildKey('entry', key), this._buildKey('prompt', key))

    if (Array.isArray(embeddingKeys) && embeddingKeys.length > 0) {
      await redis.batchDelChunked(embeddingKeys)
    }
  }

  async getAllEmbeddings(scopeKey) {
    const prefix = this._buildKey('embedding', `${scopeKey}:`)
    const keys = await redis.scanKeys(`${prefix}*`)
    if (!Array.isArray(keys) || keys.length === 0) {
      return new Map()
    }

    const results = await Promise.all(
      keys.map(async (key) => {
        const raw = await redis.get(key)
        if (!raw) {
          return null
        }

        try {
          return [key, JSON.parse(raw)]
        } catch (_) {
          return null
        }
      })
    )

    return new Map(results.filter(Boolean))
  }

  async getAllEmbeddingEntries() {
    const keys = await redis.scanKeys(this._buildKey('embedding', '*'))
    if (!Array.isArray(keys) || keys.length === 0) {
      return new Map()
    }

    const results = await Promise.all(
      keys.map(async (key) => {
        const raw = await redis.get(key)
        const payload = this._parseRawValue(raw)
        if (!Array.isArray(payload) || payload.length === 0) {
          return null
        }

        return [key, payload]
      })
    )

    return new Map(results.filter(Boolean))
  }

  async getPrompt(key) {
    const value = await this.get('prompt', key)
    return typeof value === 'string' ? value : value?.promptText || ''
  }

  async listEntries({ cursor = '0', limit = 50 } = {}) {
    const client = redis.getClientSafe()
    const normalizedLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50))
    const entryPrefix = this._buildKey('entry', '')
    const entryPattern = `${entryPrefix}*`

    let nextCursor = String(cursor || '0')
    const storageKeys = []

    do {
      const [scannedCursor, batch] = await client.scan(
        nextCursor,
        'MATCH',
        entryPattern,
        'COUNT',
        normalizedLimit
      )
      nextCursor = scannedCursor

      for (const storageKey of batch || []) {
        storageKeys.push(storageKey)
        if (storageKeys.length >= normalizedLimit) {
          break
        }
      }
    } while (nextCursor !== '0' && storageKeys.length < normalizedLimit)

    const items = await Promise.all(
      storageKeys.map(async (storageKey) => {
        const raw = await redis.get(storageKey)
        const payload = this._parseRawValue(raw)
        if (!payload || typeof payload !== 'object') {
          return null
        }

        return {
          key: storageKey.slice(entryPrefix.length),
          statusCode: Number.parseInt(payload.statusCode, 10) || 200,
          createdAt: Number.parseInt(payload.createdAt, 10) || 0,
          ttlSeconds: Number.parseInt(payload.ttlSeconds, 10) || 0
        }
      })
    )

    return {
      items: items.filter(Boolean),
      nextCursor,
      hasMore: nextCursor !== '0',
      limit: normalizedLimit
    }
  }

  async getStats() {
    const [entryKeys, promptKeys, embeddingKeys, metricKeys] = await Promise.all([
      redis.scanKeys(this._buildKey('entry', '*')),
      redis.scanKeys(this._buildKey('prompt', '*')),
      redis.scanKeys(this._buildKey('embedding', '*')),
      redis.scanKeys(`${this.namespace}:metrics:*`)
    ])

    const entryCount = entryKeys?.length || 0
    const promptCount = promptKeys?.length || 0
    const embeddingCount = embeddingKeys?.length || 0
    const metricsKeyCount = metricKeys?.length || 0

    return {
      namespace: this.namespace,
      entryCount,
      promptCount,
      embeddingCount,
      metricsKeyCount,
      totalKeys: entryCount + promptCount + embeddingCount + metricsKeyCount
    }
  }

  async clearAll() {
    const keys = await redis.scanKeys(`${this.namespace}:*`)
    if (!Array.isArray(keys) || keys.length === 0) {
      return 0
    }

    return redis.batchDelChunked(keys)
  }

  async close() {}
}

module.exports = RedisTokenCacheStorage
