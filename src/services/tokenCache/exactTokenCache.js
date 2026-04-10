const crypto = require('crypto')
const LRUCache = require('../../utils/lruCache')

class ExactTokenCache {
  constructor(storage, options = {}) {
    this.storage = storage
    this.ttlSeconds = Number.parseInt(options.ttlSeconds, 10) || 24 * 60 * 60
    this.hotCache = new LRUCache(Number.parseInt(options.maxEntries, 10) || 1000)
  }

  static generateKey(input) {
    return crypto
      .createHash('sha256')
      .update(String(input || ''))
      .digest('hex')
  }

  async get(key) {
    const hotItem = this.hotCache.get(key)
    if (hotItem) {
      return hotItem
    }

    const storedItem = await this.storage.get('entry', key)
    if (!storedItem || typeof storedItem !== 'object') {
      return null
    }

    const createdAt = Number.parseInt(storedItem.createdAt, 10) || Date.now()
    const ttlSeconds = Number.parseInt(storedItem.ttlSeconds, 10) || this.ttlSeconds
    if (ttlSeconds > 0 && createdAt + ttlSeconds * 1000 <= Date.now()) {
      await this.storage.delete(key)
      return null
    }

    const remainingTtlMs =
      ttlSeconds > 0 ? Math.max(1000, createdAt + ttlSeconds * 1000 - Date.now()) : 0
    this.hotCache.set(key, storedItem, remainingTtlMs)
    return storedItem
  }

  async set(key, value, ttlSeconds = this.ttlSeconds) {
    const cacheItem = {
      ...value,
      createdAt: Date.now(),
      ttlSeconds
    }

    await this.storage.set('entry', key, cacheItem, ttlSeconds)
    this.hotCache.set(key, cacheItem, ttlSeconds > 0 ? ttlSeconds * 1000 : 0)
    return cacheItem
  }

  async delete(key) {
    this.hotCache.cache.delete(key)
    await this.storage.delete(key)
  }
}

module.exports = ExactTokenCache
