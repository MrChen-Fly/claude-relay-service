const openaiL1CacheService = require('../openaiL1CacheService')
const openaiL2SemanticCacheService = require('../openaiL2SemanticCacheService')
const openaiL3GlobalCacheService = require('../openaiL3GlobalCacheService')
const contextBufferService = require('./contextBufferService')
const { buildCacheContext } = require('./cacheContextBuilder')
const logger = require('../../../utils/logger')

class OpenAICacheChainService {
  async beginRequest(context = {}) {
    const lookupContext =
      context.isStream || context.requestBody?.stream
        ? {
            ...context,
            allowStreamLookup: true
          }
        : context
    const bufferSnapshot = await contextBufferService.getSnapshot(context)
    const cacheContext = buildCacheContext(context, bufferSnapshot)
    const semanticTextResult = openaiL2SemanticCacheService.extractSemanticText(
      context.requestBody,
      {
        cacheContext
      }
    )
    const semanticRequestText = semanticTextResult.supported
      ? semanticTextResult.focalText || semanticTextResult.text || ''
      : ''

    const l1Decision = await openaiL1CacheService.beginRequest(lookupContext)
    if (l1Decision.kind === 'hit') {
      return {
        kind: 'hit',
        source: 'l1',
        entry: l1Decision.entry,
        l1Decision,
        l2Decision: null,
        l3Decision: null,
        semanticRequestText,
        bufferSnapshot,
        cacheContext
      }
    }

    const l2Decision = await openaiL2SemanticCacheService.beginRequest({
      ...lookupContext,
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
        l3Decision: null,
        semanticRequestText,
        bufferSnapshot,
        cacheContext
      }
    }

    const l3Decision = await openaiL3GlobalCacheService.beginRequest(lookupContext)
    if (l3Decision.kind === 'hit') {
      if (l1Decision?.kind === 'miss') {
        await openaiL1CacheService.storeResponse(l1Decision, l3Decision.entry)
      }

      if (l2Decision?.kind === 'miss') {
        await openaiL2SemanticCacheService.storeResponse(l2Decision, l3Decision.entry)
      }

      return {
        kind: 'hit',
        source: 'l3',
        entry: l3Decision.entry,
        l1Decision,
        l2Decision,
        l3Decision,
        semanticRequestText,
        bufferSnapshot,
        cacheContext
      }
    }

    return {
      kind: l3Decision.kind || l2Decision.kind || l1Decision.kind,
      source: 'upstream',
      entry: null,
      l1Decision,
      l2Decision,
      l3Decision,
      semanticRequestText,
      bufferSnapshot,
      cacheContext
    }
  }

  async replayCachedResponse(res, decision = {}) {
    await this.recordCacheReplay(decision)

    return openaiL1CacheService.replayCachedResponse(res, decision.entry)
  }

  async recordCacheReplay(decision = {}) {
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
  }

  async prepareStreamWriteback(decision, context = {}) {
    if (!decision) {
      return null
    }

    const nextDecision = {
      ...decision
    }

    if (decision.l1Decision?.kind === 'bypass' && decision.l1Decision.reason === 'stream_request') {
      nextDecision.l1Decision = await openaiL1CacheService.createCaptureDecision(context)
    }

    if (decision.l2Decision?.kind === 'bypass' && decision.l2Decision.reason === 'stream_request') {
      nextDecision.l2Decision = await openaiL2SemanticCacheService.createCaptureDecision({
        ...context,
        cacheContext: decision.cacheContext
      })
    }

    if (decision.l3Decision?.kind === 'bypass' && decision.l3Decision.reason === 'stream_request') {
      nextDecision.l3Decision = await openaiL3GlobalCacheService.createCaptureDecision(context)
    }

    return nextDecision
  }

  async storeUpstreamResponse(decision, responseContext = {}) {
    if (!decision) {
      return { stored: false }
    }

    if (decision.l1Decision?.kind === 'miss') {
      await openaiL1CacheService.storeResponse(decision.l1Decision, responseContext)
    }

    if (decision.l2Decision?.kind === 'miss') {
      await openaiL2SemanticCacheService.storeResponse(decision.l2Decision, responseContext)
    }

    if (decision.l3Decision?.kind === 'miss') {
      await openaiL3GlobalCacheService.storeResponse(decision.l3Decision, responseContext)
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
    await Promise.all([
      openaiL1CacheService.finalizeRequest(decision?.l1Decision || decision),
      openaiL3GlobalCacheService.finalizeRequest(decision?.l3Decision)
    ])
  }
}

module.exports = new OpenAICacheChainService()
