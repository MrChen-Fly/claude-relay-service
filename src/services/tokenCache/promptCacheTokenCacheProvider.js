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
    this.diagnostics = options.diagnostics || null
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

  _recordDiagnosticEvent(event = {}) {
    if (!this.diagnostics?.recordAsync) {
      return
    }

    this.diagnostics.recordAsync(event)
  }

  _buildDiagnosticEvent(context, evaluation, extra = {}) {
    const diagnostics = evaluation?.diagnostics || {}

    return {
      timestamp: extra.timestamp || Date.now(),
      eventType: extra.eventType || 'unknown',
      layer: extra.layer || '',
      reason: extra.reason || '',
      provider: this.getName(),
      accountId: context?.accountId || '',
      accountName: context?.accountName || '',
      requestedModel: context?.requestedModel || context?.requestBody?.model || '',
      promptCacheKey: context?.promptCacheKey || '',
      sessionHash: context?.sessionHash || '',
      conversationId: context?.conversationId || '',
      cacheKey: evaluation?.cacheKey || '',
      scopeKey: evaluation?.scopeKey || '',
      cacheStrategy: evaluation?.cacheStrategy || '',
      semanticEligible: evaluation?.semanticEligible !== false,
      toolCandidateCount: Number(
        evaluation?.toolCandidateCount ||
          (Array.isArray(evaluation?.toolResultCandidates)
            ? evaluation.toolResultCandidates.length
            : 0)
      ),
      messageCount: Number(diagnostics.messageCount || 0),
      promptLength: Number(diagnostics.promptLength || 0),
      transcriptLength: Number(diagnostics.transcriptLength || 0),
      systemLength: Number(diagnostics.systemLength || 0),
      promptHash: diagnostics.promptHash || '',
      transcriptHash: diagnostics.transcriptHash || '',
      systemHash: diagnostics.systemHash || '',
      score: extra.score,
      statusCode: extra.statusCode
    }
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

    const toolResultCandidates = extractToolResultCacheCandidates(context)

    return {
      ...evaluation,
      cacheKey: ExactTokenCache.generateKey(evaluation.exactKeyInput),
      toolResultCandidates,
      toolCandidateCount: toolResultCandidates.length
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
      this._recordDiagnosticEvent(
        this._buildDiagnosticEvent(context, evaluation, {
          eventType: 'bypass',
          reason: evaluation.reason || 'unknown'
        })
      )
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
            this._recordDiagnosticEvent(
              this._buildDiagnosticEvent(context, evaluation, {
                eventType: 'hit',
                layer: hitLayer,
                score: semanticHit.score
              })
            )
            return this._buildHitResult(semanticEntry, hitLayer, semanticHit.score)
          }
        }

        if (semanticHit?.rejectedReason) {
          this._recordDiagnosticEvent(
            this._buildDiagnosticEvent(context, evaluation, {
              eventType: 'semantic_reject',
              layer: semanticHit.layer || 'semantic',
              reason: semanticHit.rejectedReason,
              score: semanticHit.score
            })
          )
        }
      } catch (error) {
        if (isSemanticInputTooLargeError(error)) {
          logger.info('Prompt-cache semantic lookup skipped for oversized input', {
            provider: this.getName(),
            scopeKey: evaluation.scopeKey,
            reason: error.reason,
            details: error.details
          })
          this._recordDiagnosticEvent(
            this._buildDiagnosticEvent(context, evaluation, {
              eventType: 'semantic_skip',
              reason: error.reason || 'input_too_large'
            })
          )
        } else {
          logger.warn('Prompt-cache semantic lookup failed', {
            provider: this.getName(),
            scopeKey: evaluation.scopeKey,
            message: error.message
          })
          this._recordDiagnosticEvent(
            this._buildDiagnosticEvent(context, evaluation, {
              eventType: 'semantic_error',
              reason: error.message || 'semantic_lookup_failed'
            })
          )
        }
      }
    }

    const exactHit = await this._lookupExactEntry(evaluation)
    if (exactHit) {
      this._recordDiagnosticEvent(
        this._buildDiagnosticEvent(context, evaluation, {
          eventType: 'hit',
          layer: 'exact'
        })
      )
      return exactHit
    }

    try {
      const toolResultHit = await this._lookupToolResultEntry(context, evaluation)
      if (toolResultHit) {
        this._recordDiagnosticEvent(
          this._buildDiagnosticEvent(context, evaluation, {
            eventType: 'hit',
            layer: toolResultHit.headers?.['x-token-cache-layer'] || 'tool_result'
          })
        )
        return toolResultHit
      }
    } catch (error) {
      logger.warn('Prompt-cache tool-result lookup failed', {
        provider: this.toolResultCacheProvider.getName?.() || 'custom',
        message: error.message
      })
      this._recordDiagnosticEvent(
        this._buildDiagnosticEvent(context, evaluation, {
          eventType: 'tool_result_error',
          reason: error.message || 'tool_result_lookup_failed'
        })
      )
    }

    this._recordMetrics({
      misses: 1
    })
    this._recordDiagnosticEvent(
      this._buildDiagnosticEvent(context, evaluation, {
        eventType: 'miss',
        reason: 'cache_miss'
      })
    )

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
          this._recordDiagnosticEvent(
            this._buildDiagnosticEvent(context, evaluation, {
              eventType: 'semantic_store_skip',
              reason: error.reason || 'input_too_large'
            })
          )
        } else {
          logger.warn('Prompt-cache semantic artifact store failed', {
            cacheKey: evaluation.cacheKey,
            provider: this.getName(),
            message: error.message
          })
          this._recordDiagnosticEvent(
            this._buildDiagnosticEvent(context, evaluation, {
              eventType: 'semantic_store_error',
              reason: error.message || 'semantic_store_failed'
            })
          )
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
    this._recordDiagnosticEvent(
      this._buildDiagnosticEvent(context, evaluation, {
        eventType: 'store',
        statusCode: response.statusCode || response.status || 200
      })
    )

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
      this._recordDiagnosticEvent(
        this._buildDiagnosticEvent(context, evaluation, {
          eventType: 'tool_result_store_error',
          reason: error.message || 'tool_result_store_failed'
        })
      )
    }

    return {
      stored: true,
      cacheKey: evaluation.cacheKey
    }
  }
}

module.exports = PromptCacheTokenCacheProvider
