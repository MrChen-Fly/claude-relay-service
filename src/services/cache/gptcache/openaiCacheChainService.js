const openaiL1CacheService = require('../openaiL1CacheService')
const openaiL2SemanticCacheService = require('../openaiL2SemanticCacheService')
const contextBufferService = require('./contextBufferService')
const { buildCacheContext } = require('./cacheContextBuilder')
const logger = require('../../../utils/logger')

class OpenAICacheChainService {
  async beginRequest(context = {}) {
    const semanticTextResult = openaiL2SemanticCacheService.extractSemanticText(context.requestBody)
    const semanticRequestText = semanticTextResult.supported ? semanticTextResult.text : ''
    const bufferSnapshot = await contextBufferService.getSnapshot(context)
    const cacheContext = buildCacheContext(context, bufferSnapshot)

    const l1Decision = await openaiL1CacheService.beginRequest(context)
    if (l1Decision.kind === 'hit') {
      return {
        kind: 'hit',
        source: 'l1',
        entry: l1Decision.entry,
        l1Decision,
        l2Decision: null,
        semanticRequestText,
        bufferSnapshot,
        cacheContext
      }
    }

    const l2Decision = await openaiL2SemanticCacheService.beginRequest({
      ...context,
      cacheContext
    })
    if (l2Decision.kind === 'hit') {
      if (l1Decision?.kind === 'miss') {
        await openaiL1CacheService.storeResponse(l1Decision, l2Decision.entry)
      }

      return {
        kind: 'hit',
        source: 'l2',
        entry: l2Decision.entry,
        l1Decision,
        l2Decision,
        semanticRequestText,
        bufferSnapshot,
        cacheContext
      }
    }

    return {
      kind: l2Decision.kind || l1Decision.kind,
      source: 'upstream',
      entry: null,
      l1Decision,
      l2Decision,
      semanticRequestText,
      bufferSnapshot,
      cacheContext
    }
  }

  async replayCachedResponse(res, decision = {}) {
    const responseText = openaiL2SemanticCacheService.extractResponseText(
      decision.entry?.body || {}
    )
    if (decision.semanticRequestText && responseText) {
      try {
        await contextBufferService.rememberInteraction(decision.bufferSnapshot, {
          requestText: decision.semanticRequestText,
          responseText,
          model: decision.entry?.actualModel || null,
          cacheSource: decision.source
        })
      } catch (error) {
        logger.warn('Failed to update OpenAI context buffer after cache replay', {
          reason: error.message
        })
      }
    }

    return openaiL1CacheService.replayCachedResponse(res, decision.entry)
  }

  async storeUpstreamResponse(decision, responseContext = {}) {
    if (!decision) {
      return { stored: false }
    }

    if (decision.l1Decision?.kind === 'miss') {
      await openaiL1CacheService.storeResponse(decision.l1Decision, responseContext)
    }

    if (['miss', 'shadow_hit'].includes(decision.l2Decision?.kind)) {
      await openaiL2SemanticCacheService.storeResponse(decision.l2Decision, responseContext)
    }

    const responseText = openaiL2SemanticCacheService.extractResponseText(
      responseContext.body || {}
    )
    if (decision.semanticRequestText && responseText) {
      try {
        await contextBufferService.rememberInteraction(decision.bufferSnapshot, {
          requestText: decision.semanticRequestText,
          responseText,
          model: responseContext.actualModel || null,
          cacheSource: 'upstream'
        })
      } catch (error) {
        logger.warn('Failed to update OpenAI context buffer after upstream response', {
          reason: error.message
        })
      }
    }

    return { stored: true }
  }

  async finalizeRequest(decision) {
    await openaiL1CacheService.finalizeRequest(decision?.l1Decision || decision)
  }
}

module.exports = new OpenAICacheChainService()
