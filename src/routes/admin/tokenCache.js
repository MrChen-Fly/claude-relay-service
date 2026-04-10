const express = require('express')
const config = require('../../../config/config')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const RedisTokenCacheStorage = require('../../services/tokenCache/redisTokenCacheStorage')
const tokenCacheMetricsService = require('../../services/tokenCache/tokenCacheMetricsService')
const openaiResponsesRelayService = require('../../services/relay/openaiResponsesRelayService')

const router = express.Router()
const storage = new RedisTokenCacheStorage({
  namespace: config.tokenCache?.namespace
})

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.min(parsed, max)
}

function getTokenCacheProvider() {
  if (typeof openaiResponsesRelayService?._getTokenCacheProvider !== 'function') {
    return null
  }

  return openaiResponsesRelayService._getTokenCacheProvider()
}

function clearExactHotCache() {
  const hotCache = getTokenCacheProvider()?.exactCache?.hotCache
  if (typeof hotCache?.clear === 'function') {
    hotCache.clear()
  }
}

function deleteExactHotCacheEntry(key) {
  const hotCacheMap = getTokenCacheProvider()?.exactCache?.hotCache?.cache
  if (typeof hotCacheMap?.delete === 'function') {
    hotCacheMap.delete(key)
  }
}

async function deleteTokenCacheEntry(key) {
  const exactCache = getTokenCacheProvider()?.exactCache
  if (typeof exactCache?.delete === 'function') {
    await exactCache.delete(key)
    return
  }

  await storage.delete(key)
}

router.get('/token-cache/stats', authenticateAdmin, async (req, res) => {
  try {
    const windowMinutes = parsePositiveInteger(req.query.windowMinutes, 60, 1440)
    const [metrics, storageStats] = await Promise.all([
      tokenCacheMetricsService.getSnapshot(windowMinutes),
      storage.getStats()
    ])

    return res.json({
      success: true,
      data: {
        metrics,
        storage: storageStats
      }
    })
  } catch (error) {
    logger.error('Failed to get token cache stats:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get token cache stats',
      message: error.message
    })
  }
})

router.get('/token-cache/entries', authenticateAdmin, async (req, res) => {
  try {
    const limit = parsePositiveInteger(req.query.limit, 50, 100)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '0'
    const entries = await storage.listEntries({
      cursor,
      limit
    })

    return res.json({
      success: true,
      data: {
        items: entries.items,
        pagination: {
          cursor,
          nextCursor: entries.nextCursor,
          hasMore: entries.hasMore,
          limit: entries.limit
        }
      }
    })
  } catch (error) {
    logger.error('Failed to list token cache entries:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to list token cache entries',
      message: error.message
    })
  }
})

router.delete('/token-cache/entries', authenticateAdmin, async (req, res) => {
  try {
    const deletedCount = await storage.clearAll()
    clearExactHotCache()

    logger.warn(`Admin ${req.admin?.username || 'unknown'} cleared token cache`)

    return res.json({
      success: true,
      message: 'Token cache cleared successfully',
      deletedCount
    })
  } catch (error) {
    logger.error('Failed to clear token cache:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to clear token cache',
      message: error.message
    })
  }
})

router.delete('/token-cache/entries/:key', authenticateAdmin, async (req, res) => {
  try {
    const key = String(req.params.key || '').trim()
    if (!key) {
      return res.status(400).json({
        success: false,
        error: 'Token cache key is required'
      })
    }

    await deleteTokenCacheEntry(key)
    deleteExactHotCacheEntry(key)

    logger.warn(`Admin ${req.admin?.username || 'unknown'} deleted token cache entry ${key}`)

    return res.json({
      success: true,
      message: 'Token cache entry deleted successfully',
      key
    })
  } catch (error) {
    logger.error(`Failed to delete token cache entry ${req.params.key}:`, error)
    return res.status(500).json({
      success: false,
      error: 'Failed to delete token cache entry',
      message: error.message
    })
  }
})

module.exports = router
