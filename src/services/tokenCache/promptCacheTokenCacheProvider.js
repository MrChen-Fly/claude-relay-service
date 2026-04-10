const { TokenCacheProvider } = require('./tokenCacheProvider')
const { evaluateTokenCacheRequest } = require('./requestTextExtractor')
const { extractToolResultCacheCandidates } = require('./toolResultCacheCandidateExtractor')
const { NoopToolResultCacheProvider } = require('./toolResultCacheProvider')
const ExactTokenCache = require('./exactTokenCache')
const { isSemanticInputTooLargeError } = require('./semanticProviderErrors')
const logger = require('../../utils/logger')

class PromptCacheTokenCacheProvider extends TokenCacheProvider {
  constructor(options = {}) {
    super()
    this.storage = options.storage
    this.config = options.config || {}
    this.metrics = options.metrics || null
    this.exactCache =
      options.exactCache ||
      new ExactTokenCache(this.storage, {
        ttlSeconds: this.config.ttlSeconds,
        maxEntries: this.config.maxEntries
      })
    this.semanticEngine = options.semanticEngine || null
    this.toolResultCacheProvider =
      options.toolResultCacheProvider || new NoopToolResultCacheProvider()
  }

  getName() {
    return 'prompt-cache'
  }

  _recordMetrics(fields = {}) {
    if (!this.metrics?.recordAsync) {
      return
    }

    this.metrics.recordAsync(fields)
  }

  _buildHitResult(entry, layer, score = undefined) {
    const headers = {
      'x-token-cache': 'HIT',
      'x-token-cache-layer': layer,
      'x-token-cache-provider': this.getName()
    }

    if (score !== undefined && score !== null) {
      headers['x-token-cache-score'] = String(score || 0)
    }

    return {
      hit: true,
      statusCode: entry.statusCode || 200,
      body: entry.body,
      headers
    }
  }

  _buildHitMetrics(layer) {
    if (layer === 'exact') {
      return {
        hits: 1,
        exactHits: 1
      }
    }

    if (layer === 'tool_result') {
      return {
        hits: 1,
        toolResultHits: 1
      }
    }

    const semanticMetrics = {
      hits: 1,
      semanticHits: 1
    }

    if (layer === 'semantic_verified') {
      semanticMetrics.semanticVerifiedHits = 1
    }

    return semanticMetrics
  }

  _resolveSemanticHitLayer(cacheKey, semanticHit = {}) {
    if (semanticHit.layer === 'semantic_verified') {
      return 'semantic_verified'
    }

    if (semanticHit.cacheKey === cacheKey) {
      return 'exact'
    }

    return semanticHit.layer || 'semantic'
  }

  _evaluateContext(context) {
    const evaluation = evaluateTokenCacheRequest(context)
    if (!evaluation.eligible) {
      return evaluation
    }

    return {
      ...evaluation,
      cacheKey: ExactTokenCache.generateKey(evaluation.exactKeyInput),
      toolResultCandidates: extractToolResultCacheCandidates(context)
    }
  }

  async _lookupToolResultEntry(context, evaluation) {
    if (
      !this.toolResultCacheProvider?.isEnabled?.() ||
      typeof this.toolResultCacheProvider.lookupCandidates !== 'function' ||
      !Array.isArray(evaluation.toolResultCandidates) ||
      evaluation.toolResultCandidates.length === 0
    ) {
      return null
    }

    const result = await this.toolResultCacheProvider.lookupCandidates(
      context,
      evaluation.toolResultCandidates
    )
    if (!result || result.hit !== true) {
      return null
    }

    const layer = result.layer || 'tool_result'
    this._recordMetrics(this._buildHitMetrics(layer))

    const hitResult = this._buildHitResult(
      {
        statusCode: result.statusCode || result.status || 200,
        body: result.body
      },
      layer,
      result.score
    )
    hitResult.headers = {
      ...hitResult.headers,
      ...(result.headers || {})
    }
    return hitResult
  }

  async _storeToolResultArtifacts(context, evaluation, response) {
    if (
      !this.toolResultCacheProvider?.isEnabled?.() ||
      typeof this.toolResultCacheProvider.storeCandidates !== 'function' ||
      !Array.isArray(evaluation.toolResultCandidates) ||
      evaluation.toolResultCandidates.length === 0
    ) {
      return null
    }

    return this.toolResultCacheProvider.storeCandidates(
      context,
      evaluation.toolResultCandidates,
      response
    )
  }

  async _lookupExactEntry(evaluation) {
    const exactHit = await this.exactCache.get(evaluation.cacheKey)
    if (!exactHit) {
      return null
    }

    this._recordMetrics({
      hits: 1,
      exactHits: 1
    })
    return this._buildHitResult(exactHit, 'exact')
  }

  async lookup(context) {
    const evaluation = this._evaluateContext(context)
    if (!evaluation.eligible) {
      this._recordMetrics({
        requests: 1,
        bypasses: 1,
        [`bypassReason:${evaluation.reason || 'unknown'}`]: 1
      })
      return {
        hit: false,
        reason: evaluation.reason
      }
    }

    this._recordMetrics({
      requests: 1,
      eligibleRequests: 1
    })

    if (evaluation.semanticEligible !== false && this.semanticEngine?.isEnabled?.()) {
      try {
        const semanticHit = await this.semanticEngine.findSimilar({
          scopeKey: evaluation.scopeKey,
          promptText: evaluation.promptText
        })

        if (semanticHit?.cacheKey) {
          const semanticEntry = await this.exactCache.get(semanticHit.cacheKey)
          if (semanticEntry) {
            const hitLayer = this._resolveSemanticHitLayer(evaluation.cacheKey, semanticHit)
            this._recordMetrics(this._buildHitMetrics(hitLayer))
            return this._buildHitResult(semanticEntry, hitLayer, semanticHit.score)
          }
        }
      } catch (error) {
        if (isSemanticInputTooLargeError(error)) {
          logger.info('Prompt-cache semantic lookup skipped for oversized input', {
            provider: this.getName(),
            scopeKey: evaluation.scopeKey,
            reason: error.reason,
            details: error.details
          })
        } else {
          logger.warn('Prompt-cache semantic lookup failed', {
            provider: this.getName(),
            scopeKey: evaluation.scopeKey,
            message: error.message
          })
        }
      }
    }

    const exactHit = await this._lookupExactEntry(evaluation)
    if (exactHit) {
      return exactHit
    }

    try {
      const toolResultHit = await this._lookupToolResultEntry(context, evaluation)
      if (toolResultHit) {
        return toolResultHit
      }
    } catch (error) {
      logger.warn('Prompt-cache tool-result lookup failed', {
        provider: this.toolResultCacheProvider.getName?.() || 'custom',
        message: error.message
      })
    }

    this._recordMetrics({
      misses: 1
    })

    return {
      hit: false,
      reason: 'cache_miss'
    }
  }

  async store(context, response) {
    const evaluation = this._evaluateContext(context)
    if (!evaluation.eligible) {
      return {
        stored: false,
        reason: evaluation.reason
      }
    }

    await this.exactCache.set(
      evaluation.cacheKey,
      {
        statusCode: response.statusCode || response.status || 200,
        body: response.body
      },
      this.config.ttlSeconds
    )

    if (evaluation.semanticEligible !== false && this.semanticEngine?.isEnabled?.()) {
      try {
        await this.semanticEngine.store({
          scopeKey: evaluation.scopeKey,
          cacheKey: evaluation.cacheKey,
          promptText: evaluation.promptText,
          ttlSeconds: this.config.ttlSeconds
        })
      } catch (error) {
        if (isSemanticInputTooLargeError(error)) {
          logger.info('Prompt-cache semantic artifact store skipped for oversized input', {
            cacheKey: evaluation.cacheKey,
            provider: this.getName(),
            reason: error.reason,
            details: error.details
          })
        } else {
          logger.warn('Prompt-cache semantic artifact store failed', {
            cacheKey: evaluation.cacheKey,
            provider: this.getName(),
            message: error.message
          })
        }
      }
    } else {
      try {
        await this.storage.set(
          'prompt',
          evaluation.cacheKey,
          { promptText: evaluation.promptText },
          this.config.ttlSeconds
        )
      } catch (error) {
        logger.warn('Prompt-cache prompt store failed', {
          cacheKey: evaluation.cacheKey,
          provider: this.getName(),
          message: error.message
        })
      }
    }

    this._recordMetrics({
      stores: 1
    })

    try {
      const toolResultStoreResult = await this._storeToolResultArtifacts(
        context,
        evaluation,
        response
      )
      if (toolResultStoreResult?.stored === true) {
        this._recordMetrics({
          toolResultStores: 1
        })
      }
    } catch (error) {
      logger.warn('Prompt-cache tool-result store failed', {
        provider: this.toolResultCacheProvider.getName?.() || 'custom',
        message: error.message
      })
    }

    return {
      stored: true,
      cacheKey: evaluation.cacheKey
    }
  }
}

module.exports = PromptCacheTokenCacheProvider
