const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
const ProxyHelper = require('../../utils/proxyHelper')
const logger = require('../../utils/logger')
const { filterForOpenAI } = require('../../utils/headerFilter')
const openaiResponsesAccountService = require('../account/openaiResponsesAccountService')
const apiKeyService = require('../apiKeyService')
const unifiedOpenAIScheduler = require('../scheduler/unifiedOpenAIScheduler')
const config = require('../../../config/config')
const crypto = require('crypto')
const LRUCache = require('../../utils/lruCache')
const upstreamErrorHelper = require('../../utils/upstreamErrorHelper')
const { IncrementalSSEParser } = require('../../utils/sseParser')
const ChatToResponsesConverter = require('../openaiProtocol/chatToResponsesConverter')
const CodexToOpenAIConverter = require('../codexToOpenAI')
const { buildCachedResponsesStreamEvents } = require('./openaiResponsesCachedStreamEvents')
const redis = require('../../models/redis')
const {
  normalizeTargetPath,
  shouldRetryWithAlternateProtocol
} = require('../openaiProtocol/upstreamProtocolHelper')
const { normalizeResponsesToolingRequest } = require('../openaiProtocol/toolingNormalizer')
const {
  NoopTokenCacheProvider,
  buildTokenCacheRequestContext,
  extractPromptCacheKey,
  extractStableTokenCacheSessionKey
} = require('../tokenCache/tokenCacheProvider')
const createDefaultTokenCacheProvider = require('../tokenCache/createDefaultTokenCacheProvider')
const tokenCacheMetricsService = require('../tokenCache/tokenCacheMetricsService')
const { buildProviderPromptCacheMetrics } = require('../tokenCache/providerPromptCacheMetrics')
const {
  createRequestDetailMeta,
  extractOpenAICacheReadTokens
} = require('../../utils/requestDetailHelper')

// lastUsedAt 更新节流（每账户 60 秒内最多更新一次，使用 LRU 防止内存泄漏）
const lastUsedAtThrottle = new LRUCache(1000) // 最多缓存 1000 个账户
const LAST_USED_AT_THROTTLE_MS = 60000

// 抽取缓存写入 token，兼容多种字段命名
function extractCacheCreationTokens(usageData) {
  if (!usageData || typeof usageData !== 'object') {
    return 0
  }

  const details = usageData.input_tokens_details || usageData.prompt_tokens_details || {}
  const candidates = [
    details.cache_creation_input_tokens,
    details.cache_creation_tokens,
    usageData.cache_creation_input_tokens,
    usageData.cache_creation_tokens
  ]

  for (const value of candidates) {
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }
  }

  return 0
}

function toSSE(event) {
  return `data: ${JSON.stringify(event)}\n\n`
}

class OpenAIResponsesRelayService {
  constructor(tokenCacheProvider = new NoopTokenCacheProvider()) {
    this.defaultTimeout = config.requestTimeout || 600000
    this.tokenCacheProvider = tokenCacheProvider
  }

  setTokenCacheProvider(provider = null) {
    this.tokenCacheProvider = provider || new NoopTokenCacheProvider()
    return this.tokenCacheProvider
  }

  _getTokenCacheProvider() {
    if (!this.tokenCacheProvider) {
      this.tokenCacheProvider = new NoopTokenCacheProvider()
    }

    return this.tokenCacheProvider
  }

  // 节流更新 lastUsedAt
  async _throttledUpdateLastUsedAt(accountId) {
    const now = Date.now()
    const lastUpdate = lastUsedAtThrottle.get(accountId)

    if (lastUpdate && now - lastUpdate < LAST_USED_AT_THROTTLE_MS) {
      return // 跳过更新
    }

    lastUsedAtThrottle.set(accountId, now, LAST_USED_AT_THROTTLE_MS)
    await openaiResponsesAccountService.updateAccount(accountId, {
      lastUsedAt: new Date().toISOString()
    })
  }

  _getMaxConcurrentTasks(account) {
    return Number.parseInt(account?.maxConcurrentTasks, 10) || 0
  }

  async _acquireConcurrencySlot(account, requestId, { isStream = false } = {}) {
    const maxConcurrentTasks = this._getMaxConcurrentTasks(account)
    if (maxConcurrentTasks <= 0) {
      return false
    }

    const newConcurrency = Number(
      await redis.incrOpenAIResponsesAccountConcurrency(account.id, requestId, 600)
    )

    if (newConcurrency > maxConcurrentTasks) {
      await redis.decrOpenAIResponsesAccountConcurrency(account.id, requestId)
      logger.warn(
        `⚠️ OpenAI-Responses account ${account.name} (${account.id}) concurrency limit exceeded: ${newConcurrency}/${maxConcurrentTasks}${isStream ? ' (stream request)' : ''} (request: ${requestId}, rolled back)`
      )

      const error = new Error('OpenAI-Responses account concurrency limit reached')
      error.code = 'OPENAI_RESPONSES_ACCOUNT_CONCURRENCY_FULL'
      error.statusCode = 503
      throw error
    }

    logger.debug(
      `🔓 Acquired concurrency slot for OpenAI-Responses account ${account.name} (${account.id}), current: ${newConcurrency}/${maxConcurrentTasks}${isStream ? ' [stream]' : ''}, request: ${requestId}`
    )

    return true
  }

  async _releaseConcurrencySlot(accountId, requestId, { isStream = false } = {}) {
    await redis.decrOpenAIResponsesAccountConcurrency(accountId, requestId)
    logger.debug(
      `🔓 Released concurrency slot for OpenAI-Responses account ${accountId}${isStream ? ' [stream]' : ''}, request: ${requestId}`
    )
  }

  _startConcurrencyLeaseRefresh(account, requestId) {
    const interval = setInterval(
      async () => {
        try {
          await redis.refreshOpenAIResponsesAccountConcurrencyLease(account.id, requestId, 600)
          logger.debug(
            `🔄 Refreshed concurrency lease for OpenAI-Responses account ${account.name} (${account.id}), request: ${requestId}`
          )
        } catch (error) {
          logger.error(
            `❌ Failed to refresh concurrency lease for OpenAI-Responses account ${account.id}, request: ${requestId}:`,
            error.message
          )
        }
      },
      5 * 60 * 1000
    )

    if (typeof interval.unref === 'function') {
      interval.unref()
    }

    return interval
  }

  _getCacheEndpointFromPath(pathname = '') {
    return (
      String(pathname || '')
        .replace(/^\/v1\//, '')
        .replace(/^\//, '')
        .trim() || 'responses'
    )
  }

  _buildClientPayload(responseData, responseAdapter = null) {
    let clientPayload = responseData
    if (responseAdapter?.convertJson) {
      try {
        clientPayload = responseAdapter.convertJson(responseData)
      } catch (error) {
        logger.error('Failed to transform non-stream response:', error)
      }
    }

    return clientPayload
  }

  _normalizeNonStreamSuccessData(response) {
    if (!response || response.data === undefined || response.data === null) {
      return response?.data
    }

    if (Buffer.isBuffer(response.data)) {
      const decoded = response.data.toString('utf8')
      if (!decoded.trim()) {
        return ''
      }

      try {
        return JSON.parse(decoded)
      } catch (_) {
        return decoded
      }
    }

    if (typeof response.data === 'string') {
      const trimmed = response.data.trim()
      if (!trimmed) {
        return ''
      }

      try {
        return JSON.parse(trimmed)
      } catch (_) {
        return response.data
      }
    }

    return response.data
  }

  _hasStructuredNonStreamSuccessBody(response) {
    const payload = response?.data
    return !!payload && typeof payload === 'object' && !payload.pipe && !Buffer.isBuffer(payload)
  }

  // 处理请求转发
  async handleRequest(req, res, account, apiKeyData, options = {}) {
    let abortController = null
    const requestId = uuidv4()
    let concurrencyAcquired = false
    let leaseRefreshInterval = null
    let releaseConcurrencyInFinally = true
    const sessionKey = extractStableTokenCacheSessionKey(req, req.body)
    const sessionHash = sessionKey
      ? crypto.createHash('sha256').update(sessionKey).digest('hex')
      : null

    try {
      const fullAccount = await openaiResponsesAccountService.getAccount(account.id)
      if (!fullAccount) {
        throw new Error('Account not found')
      }

      abortController = new AbortController()

      const handleClientDisconnect = () => {
        logger.info('Client disconnected, aborting OpenAI-Responses request')
        if (abortController && !abortController.signal.aborted) {
          abortController.abort()
        }
      }

      req.once('close', handleClientDisconnect)
      res.once('close', handleClientDisconnect)

      const attempts = this._buildAttempts(req, options)
      const lookupAttempt = attempts[0] || null
      const lookupTokenCacheContext = this._buildTokenCacheContext(lookupAttempt, req, fullAccount)
      const tokenCacheHitServed = await this._tryServeTokenCacheHit(res, lookupTokenCacheContext)
      if (tokenCacheHitServed) {
        req.removeListener('close', handleClientDisconnect)
        res.removeListener('close', handleClientDisconnect)
        return
      }

      const isStreamRequest = attempts.some((attempt) => !!attempt.body?.stream)

      concurrencyAcquired = await this._acquireConcurrencySlot(fullAccount, requestId, {
        isStream: isStreamRequest
      })
      if (concurrencyAcquired && isStreamRequest) {
        leaseRefreshInterval = this._startConcurrencyLeaseRefresh(fullAccount, requestId)
      }

      const headers = this._buildRequestHeaders(req, fullAccount)
      let response = null
      let selectedAttempt = attempts[0]

      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index]
        const requestedModel = attempt.requestedModel || attempt.body?.model || null
        const resolvedModel = openaiResponsesAccountService.getMappedModel(
          fullAccount.modelMapping || fullAccount.supportedModels,
          requestedModel
        )
        if (attempt.body?.model && resolvedModel !== attempt.body.model) {
          logger.info('Applying OpenAI-Responses account model mapping', {
            accountId: account.id,
            accountName: account.name,
            requestedModel,
            resolvedModel
          })
        }
        if (attempt.body && typeof attempt.body === 'object' && resolvedModel) {
          attempt.body.model = resolvedModel
        }

        const targetPath = normalizeTargetPath(fullAccount.baseApi || '', attempt.path)
        const targetUrl = `${fullAccount.baseApi || ''}${targetPath}`
        const requestOptions = {
          method: req.method,
          url: targetUrl,
          headers,
          data: attempt.body,
          timeout: this.defaultTimeout,
          responseType: attempt.body?.stream ? 'stream' : 'json',
          validateStatus: () => true,
          signal: abortController.signal
        }

        if (fullAccount.proxy) {
          const proxyAgent = ProxyHelper.createProxyAgent(fullAccount.proxy)
          if (proxyAgent) {
            requestOptions.httpAgent = proxyAgent
            requestOptions.httpsAgent = proxyAgent
            requestOptions.proxy = false
            logger.info(
              `Using proxy for OpenAI-Responses: ${ProxyHelper.getProxyDescription(fullAccount.proxy)}`
            )
          }
        }

        logger.info('OpenAI-Responses relay request', {
          accountId: account.id,
          accountName: account.name,
          targetUrl,
          method: req.method,
          stream: attempt.body?.stream || false,
          model: attempt.body?.model || 'unknown',
          userAgent: headers['User-Agent'] || 'not set',
          transform: attempt.transform || 'passthrough',
          attempt: `${index + 1}/${attempts.length}`
        })

        response = await axios(requestOptions)
        selectedAttempt = attempt

        if (!attempt.body?.stream) {
          response.data = this._normalizeNonStreamSuccessData(response)

          if (
            response.status >= 200 &&
            response.status < 300 &&
            !this._hasStructuredNonStreamSuccessBody(response) &&
            index < attempts.length - 1
          ) {
            logger.warn(
              'Upstream returned an empty or non-JSON success body, retrying alternate protocol',
              {
                accountId: account.id,
                accountName: account.name,
                currentPath: attempt.path,
                nextAttempt: `${index + 2}/${attempts.length}`,
                status: response.status,
                responseType: typeof response.data
              }
            )
            continue
          }
        }

        if (response.status >= 400) {
          await this._consumeErrorResponseData(response)
          await this._learnAccountCompatibilityFromError(fullAccount, attempt, response)

          const compatibilityRetryAttempt = this._buildCompatibilityRetryAttempt(attempt, response)
          if (compatibilityRetryAttempt) {
            attempts.splice(index + 1, 0, compatibilityRetryAttempt)
            logger.warn(
              'Upstream responses endpoint requires request compatibility adaptation, retrying',
              {
                accountId: account.id,
                accountName: account.name,
                currentPath: attempt.path,
                nextAttempt: `${index + 2}/${attempts.length}`,
                status: response.status,
                aggregateResponse: compatibilityRetryAttempt.aggregateResponse === true
              }
            )
            continue
          }

          if (shouldRetryWithAlternateProtocol(response, index < attempts.length - 1)) {
            logger.warn(
              'Upstream endpoint rejected the request shape, retrying alternate protocol',
              {
                accountId: account.id,
                accountName: account.name,
                currentPath: attempt.path,
                nextAttempt: `${index + 2}/${attempts.length}`,
                status: response.status
              }
            )
            continue
          }
        }

        break
      }

      const responseAdapter = this._createResponseAdapter(selectedAttempt)
      const tokenCacheContext =
        lookupTokenCacheContext || this._buildTokenCacheContext(selectedAttempt, req, fullAccount)
      const requestMetadata = this._buildRequestMetadata(
        lookupAttempt || selectedAttempt,
        req,
        tokenCacheContext
      )

      if (response.status === 429) {
        const { resetsInSeconds, errorData } = await this._handle429Error(
          account,
          response,
          selectedAttempt.body?.stream,
          sessionHash
        )

        const oaiAutoProtectionDisabled =
          account?.disableAutoProtection === true || account?.disableAutoProtection === 'true'
        if (!oaiAutoProtectionDisabled) {
          await upstreamErrorHelper
            .markTempUnavailable(
              account.id,
              'openai-responses',
              429,
              resetsInSeconds || upstreamErrorHelper.parseRetryAfter(response.headers)
            )
            .catch(() => {})
        }

        const errorResponse = errorData || {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            resets_in_seconds: resetsInSeconds
          }
        }
        return res.status(429).json(errorResponse)
      }

      if (response.status >= 400) {
        const errorData = response.data

        logger.error('OpenAI-Responses API error', {
          status: response.status,
          statusText: response.statusText,
          errorData
        })

        if (response.status === 401) {
          logger.warn(`OpenAI Responses account unauthorized (401) for account ${account?.id}`)

          try {
            const oaiAutoProtectionDisabled =
              account?.disableAutoProtection === true || account?.disableAutoProtection === 'true'
            if (!oaiAutoProtectionDisabled) {
              await upstreamErrorHelper
                .markTempUnavailable(account.id, 'openai-responses', 401)
                .catch(() => {})
            }
            if (sessionHash) {
              await unifiedOpenAIScheduler._deleteSessionMapping(sessionHash).catch(() => {})
            }
          } catch (markError) {
            logger.error(
              'Failed to mark OpenAI-Responses account temporarily unavailable after 401:',
              markError
            )
          }

          let unauthorizedResponse = errorData
          if (
            !unauthorizedResponse ||
            typeof unauthorizedResponse !== 'object' ||
            unauthorizedResponse.pipe ||
            Buffer.isBuffer(unauthorizedResponse)
          ) {
            const fallbackMessage =
              typeof errorData === 'string' && errorData.trim() ? errorData.trim() : 'Unauthorized'
            unauthorizedResponse = {
              error: {
                message: fallbackMessage,
                type: 'unauthorized',
                code: 'unauthorized'
              }
            }
          }

          req.removeListener('close', handleClientDisconnect)
          res.removeListener('close', handleClientDisconnect)

          return res.status(401).json(unauthorizedResponse)
        }

        if (response.status >= 500 && account?.id) {
          try {
            const oaiAutoProtectionDisabled =
              account?.disableAutoProtection === true || account?.disableAutoProtection === 'true'
            if (!oaiAutoProtectionDisabled) {
              await upstreamErrorHelper.markTempUnavailable(
                account.id,
                'openai-responses',
                response.status
              )
            }
            if (sessionHash) {
              await unifiedOpenAIScheduler._deleteSessionMapping(sessionHash).catch(() => {})
            }
          } catch (markError) {
            logger.warn(
              'Failed to mark OpenAI-Responses account temporarily unavailable:',
              markError
            )
          }
        }

        req.removeListener('close', handleClientDisconnect)
        res.removeListener('close', handleClientDisconnect)

        return res
          .status(response.status)
          .json(upstreamErrorHelper.sanitizeErrorForClient(errorData))
      }

      await this._throttledUpdateLastUsedAt(account.id)

      if (
        selectedAttempt.aggregateResponse === true &&
        response.data &&
        typeof response.data.pipe === 'function'
      ) {
        return this._handleAggregatedStreamResponse(
          response,
          res,
          account,
          apiKeyData,
          selectedAttempt.requestedModel || selectedAttempt.body?.model,
          handleClientDisconnect,
          req,
          requestMetadata,
          responseAdapter,
          tokenCacheContext
        )
      }

      if (
        selectedAttempt.body?.stream &&
        response.data &&
        typeof response.data.pipe === 'function'
      ) {
        releaseConcurrencyInFinally = false
        return this._handleStreamResponse(
          response,
          res,
          account,
          apiKeyData,
          selectedAttempt.requestedModel || selectedAttempt.body?.model,
          handleClientDisconnect,
          req,
          requestMetadata,
          responseAdapter,
          tokenCacheContext,
          async () => {
            if (leaseRefreshInterval) {
              clearInterval(leaseRefreshInterval)
              leaseRefreshInterval = null
            }

            if (concurrencyAcquired) {
              try {
                await this._releaseConcurrencySlot(account.id, requestId, { isStream: true })
              } catch (releaseError) {
                logger.error(
                  `❌ Failed to release concurrency slot for OpenAI-Responses stream account ${account.id}, request: ${requestId}:`,
                  releaseError.message
                )
              } finally {
                concurrencyAcquired = false
              }
            }
          }
        )
      }

      return this._handleNormalResponse(
        response,
        res,
        account,
        apiKeyData,
        selectedAttempt.requestedModel || selectedAttempt.body?.model,
        req._serviceTier || null,
        responseAdapter,
        requestMetadata,
        tokenCacheContext,
        req
      )
    } catch (error) {
      if (abortController && !abortController.signal.aborted) {
        abortController.abort()
      }

      const errorInfo = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText
      }
      logger.error('OpenAI-Responses relay error:', errorInfo)

      if (error.code === 'OPENAI_RESPONSES_ACCOUNT_CONCURRENCY_FULL') {
        return res.status(error.statusCode || 503).json({
          error: {
            message:
              'The selected OpenAI-Responses account has reached its concurrency limit. Please try again later.',
            type: 'account_concurrency_limit',
            code: 'account_concurrency_limit'
          }
        })
      }

      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        if (account?.id) {
          const oaiAutoProtectionDisabled =
            account?.disableAutoProtection === true || account?.disableAutoProtection === 'true'
          if (!oaiAutoProtectionDisabled) {
            await upstreamErrorHelper
              .markTempUnavailable(account.id, 'openai-responses', 503)
              .catch(() => {})
          }
        }
      }

      if (res.headersSent) {
        return res.end()
      }

      if (error.response) {
        const status = error.response.status || 500
        let errorData = {
          error: {
            message: error.response.statusText || 'Request failed',
            type: 'api_error',
            code: error.code || 'unknown'
          }
        }

        if (error.response.data) {
          if (typeof error.response.data === 'object' && !error.response.data.pipe) {
            errorData = error.response.data
          } else if (typeof error.response.data === 'string') {
            try {
              errorData = JSON.parse(error.response.data)
            } catch (e) {
              errorData.error.message = error.response.data
            }
          }
        }

        if (status === 401) {
          logger.warn(
            `OpenAI Responses account unauthorized (401) for account ${account?.id} (catch handler)`
          )

          try {
            const oaiAutoProtectionDisabled =
              account?.disableAutoProtection === true || account?.disableAutoProtection === 'true'
            if (!oaiAutoProtectionDisabled) {
              await upstreamErrorHelper
                .markTempUnavailable(account.id, 'openai-responses', 401)
                .catch(() => {})
            }
            if (sessionHash) {
              await unifiedOpenAIScheduler._deleteSessionMapping(sessionHash).catch(() => {})
            }
          } catch (markError) {
            logger.error(
              'Failed to mark OpenAI-Responses account temporarily unavailable in catch handler:',
              markError
            )
          }

          let unauthorizedResponse = errorData
          if (
            !unauthorizedResponse ||
            typeof unauthorizedResponse !== 'object' ||
            unauthorizedResponse.pipe ||
            Buffer.isBuffer(unauthorizedResponse)
          ) {
            const fallbackMessage =
              typeof errorData === 'string' && errorData.trim() ? errorData.trim() : 'Unauthorized'
            unauthorizedResponse = {
              error: {
                message: fallbackMessage,
                type: 'unauthorized',
                code: 'unauthorized'
              }
            }
          }

          return res.status(401).json(unauthorizedResponse)
        }

        return res.status(status).json(upstreamErrorHelper.sanitizeErrorForClient(errorData))
      }

      return res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'internal_error',
          details: error.message
        }
      })
    } finally {
      if (releaseConcurrencyInFinally) {
        if (leaseRefreshInterval) {
          clearInterval(leaseRefreshInterval)
          leaseRefreshInterval = null
        }

        if (concurrencyAcquired) {
          try {
            await this._releaseConcurrencySlot(account.id, requestId)
          } catch (releaseError) {
            logger.error(
              `❌ Failed to release concurrency slot for OpenAI-Responses account ${account?.id}, request: ${requestId}:`,
              releaseError.message
            )
          }
        }
      }
    }
  }

  _buildAttempts(req, options = {}) {
    const attempts =
      Array.isArray(options.attempts) && options.attempts.length > 0
        ? options.attempts
        : [{ path: req.path, body: req.body, transform: 'passthrough' }]

    return attempts.map((attempt) => ({
      path: attempt.path || req.path,
      body: this._normalizeAttemptBody(attempt.path || req.path, attempt.body || req.body),
      transform: attempt.transform || 'passthrough',
      requestedModel: attempt.requestedModel || attempt.body?.model || req.body?.model || null,
      clientStream:
        attempt.clientStream !== undefined
          ? attempt.clientStream
          : (attempt.body || req.body)?.stream === true,
      aggregateResponse: attempt.aggregateResponse === true
    }))
  }

  _normalizeAttemptBody(pathname, body) {
    if (!body || typeof body !== 'object' || !this._isResponsesPath(pathname)) {
      return body
    }

    return normalizeResponsesToolingRequest(body).body
  }

  _isResponsesPath(pathname = '') {
    const normalizedPath = `/${String(pathname || '')
      .replace(/^\/+/, '')
      .replace(/^v1\//, '')}`
    return normalizedPath === '/responses' || normalizedPath === '/responses/compact'
  }

  _extractUpstreamErrorMessage(errorData) {
    const candidates = [
      errorData,
      errorData?.detail,
      errorData?.message,
      errorData?.error?.detail,
      errorData?.error?.message
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  _isNonStreamingResponsesCompatibilityAttempt(attempt) {
    return (
      !!attempt &&
      attempt.transform === 'passthrough' &&
      this._isResponsesPath(attempt.path) &&
      attempt.clientStream !== true
    )
  }

  _detectNonStreamingResponsesCompatibilityIssue(attempt, response) {
    if (
      !this._isNonStreamingResponsesCompatibilityAttempt(attempt) ||
      ![400, 403, 422].includes(response?.status)
    ) {
      return null
    }

    const errorMessage = this._extractUpstreamErrorMessage(response?.data).toLowerCase()
    if (!errorMessage) {
      return null
    }

    if (/stream must be set to true/.test(errorMessage)) {
      return {
        reason: 'stream_required',
        errorMessage
      }
    }

    if (
      /non[- ]?stream/.test(errorMessage) &&
      /not supported|unsupported|required/.test(errorMessage)
    ) {
      return {
        reason: 'non_stream_unsupported',
        errorMessage
      }
    }

    return null
  }

  async _learnAccountCompatibilityFromError(account, attempt, response) {
    const compatibilityIssue = this._detectNonStreamingResponsesCompatibilityIssue(
      attempt,
      response
    )
    if (!compatibilityIssue || !account?.id) {
      return null
    }

    if (account.supportsNonStreamingResponses === 'false') {
      return compatibilityIssue
    }

    try {
      await openaiResponsesAccountService.updateAccount(account.id, {
        supportsNonStreamingResponses: false
      })
      account.supportsNonStreamingResponses = 'false'

      logger.warn('Learned non-stream responses incompatibility from upstream error', {
        accountId: account.id,
        accountName: account.name,
        reason: compatibilityIssue.reason
      })
    } catch (error) {
      logger.warn('Failed to persist non-stream responses incompatibility signal', {
        accountId: account.id,
        message: error.message
      })
    }

    return compatibilityIssue
  }

  _normalizeResponsesInputToList(body = {}) {
    if (
      !body ||
      typeof body !== 'object' ||
      body.input === undefined ||
      Array.isArray(body.input)
    ) {
      return {
        changed: false,
        body
      }
    }

    if (typeof body.input === 'string') {
      return {
        changed: true,
        body: {
          ...body,
          input: [
            {
              role: 'user',
              content: body.input
            }
          ]
        }
      }
    }

    return {
      changed: true,
      body: {
        ...body,
        input: [body.input]
      }
    }
  }

  _buildCompatibilityRetryAttempt(attempt, response) {
    if (
      !attempt ||
      attempt.transform !== 'passthrough' ||
      !this._isResponsesPath(attempt.path) ||
      ![400, 422].includes(response?.status)
    ) {
      return null
    }

    const errorMessage = this._extractUpstreamErrorMessage(response.data).toLowerCase()
    if (!errorMessage) {
      return null
    }

    let nextBody =
      attempt.body && typeof attempt.body === 'object' ? { ...attempt.body } : attempt.body
    let changed = false
    let aggregateResponse = attempt.aggregateResponse === true

    if (/stream must be set to true/.test(errorMessage)) {
      if (nextBody?.stream !== true) {
        nextBody = {
          ...nextBody,
          stream: true
        }
        changed = true
      }

      if (attempt.clientStream !== true) {
        aggregateResponse = true
      }
    }

    if (
      /stream must be set to true/.test(errorMessage) ||
      /input must be a list/.test(errorMessage) ||
      (/\binput\b/.test(errorMessage) && /\blist\b/.test(errorMessage))
    ) {
      const normalizedInputResult = this._normalizeResponsesInputToList(nextBody)
      if (normalizedInputResult.changed) {
        nextBody = normalizedInputResult.body
        changed = true
      }
    }

    if (!changed && aggregateResponse === attempt.aggregateResponse) {
      return null
    }

    return {
      ...attempt,
      body: nextBody,
      clientStream: attempt.clientStream === true,
      aggregateResponse
    }
  }

  _buildRequestHeaders(req, fullAccount) {
    const headers = {
      ...filterForOpenAI(req.headers),
      Authorization: `Bearer ${fullAccount.apiKey}`,
      'Content-Type': 'application/json'
    }

    if (fullAccount.userAgent) {
      headers['User-Agent'] = fullAccount.userAgent
      logger.debug(`Using custom User-Agent: ${fullAccount.userAgent}`)
    } else if (req.headers['user-agent']) {
      headers['User-Agent'] = req.headers['user-agent']
      logger.debug(`Forwarding original User-Agent: ${req.headers['user-agent']}`)
    }

    return headers
  }

  _buildRequestMetadata(selectedAttempt, req, tokenCacheContext = null) {
    const promptCacheKey =
      tokenCacheContext?.promptCacheKey || extractPromptCacheKey(selectedAttempt?.body, req?.body)
    if (!promptCacheKey) {
      return null
    }

    return {
      promptCacheKey
    }
  }

  _buildTokenCacheContext(selectedAttempt, req, account) {
    return buildTokenCacheRequestContext({
      req,
      attempt: selectedAttempt,
      account,
      accountType: 'openai-responses',
      requestedModel: selectedAttempt?.requestedModel || selectedAttempt?.body?.model || null,
      clientStream: selectedAttempt?.clientStream
    })
  }

  _applyTokenCacheHitHeaders(res, headers = {}) {
    for (const [headerName, headerValue] of Object.entries(headers)) {
      if (headerValue !== undefined && headerValue !== null && headerValue !== '') {
        res.setHeader(headerName, headerValue)
      }
    }
  }

  _writeCachedStreamResponse(res, statusCode, responseBody) {
    const streamEvents = this._buildCachedStreamEvents(responseBody)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.status(statusCode)

    if (Array.isArray(streamEvents) && typeof res.write === 'function') {
      for (const event of streamEvents) {
        res.write(event)
      }
    }

    if (typeof res.end === 'function') {
      res.end()
    }
  }

  async _tryServeTokenCacheHit(res, tokenCacheContext) {
    if (!tokenCacheContext) {
      return false
    }

    const provider = this._getTokenCacheProvider()
    if (!provider || typeof provider.lookup !== 'function') {
      return false
    }

    let lookupResult = null
    try {
      lookupResult = await provider.lookup(tokenCacheContext)
    } catch (error) {
      logger.warn('OpenAI-Responses token cache lookup failed', {
        accountId: tokenCacheContext.accountId,
        model: tokenCacheContext.requestedModel,
        message: error.message,
        provider: provider.getName?.() || 'custom'
      })
      return false
    }

    if (!lookupResult || lookupResult.hit !== true) {
      return false
    }

    if (lookupResult.headers && typeof lookupResult.headers === 'object') {
      this._applyTokenCacheHitHeaders(res, lookupResult.headers)
    }

    logger.info('Served OpenAI-Responses token cache hit', {
      accountId: tokenCacheContext.accountId,
      model: tokenCacheContext.requestedModel,
      promptCacheKey: tokenCacheContext.promptCacheKey || null,
      provider: provider.getName?.() || 'custom'
    })

    const statusCode = Number.parseInt(lookupResult.statusCode ?? lookupResult.status, 10) || 200
    const responseBody =
      lookupResult.responseBody !== undefined ? lookupResult.responseBody : lookupResult.body

    if (tokenCacheContext?.isStream) {
      this._writeCachedStreamResponse(res, statusCode, responseBody)
      return true
    }

    if (
      (Buffer.isBuffer(responseBody) || typeof responseBody === 'string') &&
      typeof res.send === 'function'
    ) {
      res.status(statusCode).send(responseBody)
      return true
    }

    res.status(statusCode).json(responseBody || {})
    return true
  }

  async _storeTokenCacheResponse(tokenCacheContext, responsePayload) {
    if (!tokenCacheContext || !responsePayload) {
      return null
    }

    const statusCode =
      Number.parseInt(responsePayload.statusCode ?? responsePayload.status, 10) || 0
    if (statusCode !== 200) {
      return null
    }

    const provider = this._getTokenCacheProvider()
    if (!provider || typeof provider.store !== 'function') {
      return null
    }

    try {
      return await provider.store(tokenCacheContext, responsePayload)
    } catch (error) {
      logger.warn('OpenAI-Responses token cache store failed', {
        accountId: tokenCacheContext.accountId,
        model: tokenCacheContext.requestedModel,
        message: error.message,
        provider: provider.getName?.() || 'custom'
      })
      return null
    }
  }

  async _consumeErrorResponseData(response) {
    if (response.data && typeof response.data.pipe === 'function') {
      const chunks = []
      await new Promise((resolve) => {
        response.data.on('data', (chunk) => chunks.push(chunk))
        response.data.on('end', resolve)
        response.data.on('error', resolve)
        setTimeout(resolve, 5000)
      })
      const fullResponse = Buffer.concat(chunks).toString()

      try {
        if (fullResponse.includes('data: ')) {
          const lines = fullResponse.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim()
              if (jsonStr && jsonStr !== '[DONE]') {
                response.data = JSON.parse(jsonStr)
                return response.data
              }
            }
          }
        }
        response.data = JSON.parse(fullResponse)
        return response.data
      } catch (error) {
        logger.error('Failed to parse error response:', error)
        response.data = { error: { message: fullResponse || 'Unknown error' } }
        return response.data
      }
    }

    if (typeof response.data === 'string') {
      try {
        response.data = JSON.parse(response.data)
      } catch (_) {
        response.data = { error: { message: response.data || 'Unknown error' } }
      }
    }

    return response.data
  }

  _createResponseAdapter(attempt = {}) {
    const requestedModel = attempt.requestedModel || attempt.body?.model || null

    if (attempt.transform === 'responses_to_chat') {
      const converter = new CodexToOpenAIConverter()
      const state = converter.createStreamState()
      let finalPayload = null

      return {
        convertJson: (payload) => converter.convertResponse(payload, requestedModel),
        writeEvent: (eventData, writeChunk) => {
          if (eventData?.error) {
            writeChunk(toSSE(eventData))
            return
          }

          if (
            eventData?.type === 'response.completed' ||
            eventData?.type === 'response.failed' ||
            eventData?.type === 'response.incomplete'
          ) {
            finalPayload = converter.convertResponse(eventData, requestedModel)
          }

          const converted = converter.convertStreamChunk(eventData, requestedModel, state)
          for (const chunk of converted) {
            writeChunk(typeof chunk === 'string' ? chunk : toSSE(chunk))
          }
        },
        getFinalPayload: () => finalPayload,
        finalizeStream: (writeChunk) => {
          writeChunk('data: [DONE]\n\n')
        }
      }
    }

    if (attempt.transform === 'chat_to_responses') {
      const converter = new ChatToResponsesConverter()
      const state = converter.createStreamState()
      let finalPayload = null

      return {
        convertJson: (payload) => converter.convertResponse(payload, requestedModel),
        writeEvent: (eventData, writeChunk) => {
          if (eventData?.error) {
            writeChunk(toSSE(eventData))
            return
          }

          const convertedEvents = converter.convertStreamChunk(eventData, requestedModel, state)
          for (const event of convertedEvents) {
            if (event?.type === 'response.completed' && event.response) {
              finalPayload = event.response
            }
            writeChunk(toSSE(event))
          }
        },
        getFinalPayload: () => finalPayload
      }
    }

    return null
  }

  _createResponsesStreamCaptureState() {
    return {
      response: null,
      outputItems: new Map()
    }
  }

  _captureResponsesStreamEvent(state, eventData = {}) {
    if (!state || !eventData || typeof eventData !== 'object') {
      return
    }

    if (
      ['response.created', 'response.in_progress', 'response.completed'].includes(eventData.type) &&
      eventData.response &&
      typeof eventData.response === 'object'
    ) {
      state.response = {
        ...(state.response || {}),
        ...eventData.response
      }
    }

    if (
      ['response.output_item.added', 'response.output_item.done'].includes(eventData.type) &&
      Number.isInteger(eventData.output_index) &&
      eventData.item &&
      typeof eventData.item === 'object'
    ) {
      state.outputItems.set(eventData.output_index, eventData.item)
    }
  }

  _buildCapturedResponsesPayload(state, fallbackResponseBody = null) {
    const source =
      fallbackResponseBody && typeof fallbackResponseBody === 'object'
        ? fallbackResponseBody
        : state?.response && typeof state.response === 'object'
          ? state.response
          : null

    if (!source) {
      return null
    }

    const response = {
      ...source
    }

    if (state?.outputItems instanceof Map && state.outputItems.size > 0) {
      response.output = Array.from(state.outputItems.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, item]) => item)
    }

    return response
  }

  async _consumeSuccessfulStreamResponse(response, responseAdapter = null) {
    let usageData = null
    let actualModel = null
    let finalResponseBody = null
    const streamCaptureState = this._createResponsesStreamCaptureState()
    const parser = new IncrementalSSEParser()

    const flushParsedEvents = (events) => {
      for (const event of events) {
        if (event.type !== 'data' || !event.data) {
          continue
        }

        this._captureResponsesStreamEvent(streamCaptureState, event.data)

        if (typeof responseAdapter?.writeEvent === 'function') {
          responseAdapter.writeEvent(event.data, () => {})
        }

        if (event.data.type === 'response.completed' && event.data.response) {
          finalResponseBody = event.data.response
          if (event.data.response.model) {
            actualModel = event.data.response.model
          }
          if (event.data.response.usage) {
            usageData = event.data.response.usage
          }
        }

        if (event.data.model) {
          actualModel = event.data.model
        }
        if (event.data.usage) {
          usageData = event.data.usage
        }
      }
    }

    await new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        try {
          flushParsedEvents(parser.feed(chunk.toString()))
        } catch (error) {
          reject(error)
        }
      })
      response.data.on('end', resolve)
      response.data.on('error', reject)
    })

    const remaining = parser.getRemaining()
    if (remaining.trim()) {
      flushParsedEvents(parser.feed('\n\n'))
    }

    const responseBody =
      responseAdapter?.getFinalPayload?.() ||
      this._buildCapturedResponsesPayload(streamCaptureState, finalResponseBody) ||
      finalResponseBody ||
      null

    return {
      responseBody,
      actualModel: actualModel || responseBody?.model || responseBody?.response?.model || null,
      usage: usageData || responseBody?.usage || responseBody?.response?.usage || null
    }
  }

  _buildCachedStreamEvents(responseBody = {}) {
    if (!responseBody || typeof responseBody !== 'object') {
      return []
    }

    if (responseBody.object === 'chat.completion' || Array.isArray(responseBody.choices)) {
      return this._buildCachedChatCompletionStreamEvents(responseBody)
    }

    return this._buildCachedResponsesStreamEvents(responseBody)
  }

  _buildCachedResponsesStreamEvents(responseBody = {}) {
    return buildCachedResponsesStreamEvents(responseBody)
  }

  _buildCachedChatCompletionStreamEvents(responseBody = {}) {
    const responseId = responseBody.id || `chatcmpl-${Date.now()}`
    const created =
      typeof responseBody.created === 'number'
        ? responseBody.created
        : Math.floor(Date.now() / 1000)
    const model = responseBody.model || 'unknown'
    const choice = responseBody.choices?.[0] || {}
    const message = choice.message || {}
    const events = []

    events.push(
      toSSE({
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              role: message.role || 'assistant'
            },
            finish_reason: null
          }
        ]
      })
    )

    if (message.reasoning_content) {
      events.push(
        toSSE({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                reasoning_content: message.reasoning_content
              },
              finish_reason: null
            }
          ]
        })
      )
    }

    if (message.content) {
      events.push(
        toSSE({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                content: message.content
              },
              finish_reason: null
            }
          ]
        })
      )
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    toolCalls.forEach((toolCall, index) => {
      events.push(
        toSSE({
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: toolCall.id,
                    type: toolCall.type || 'function',
                    function: {
                      name: toolCall.function?.name,
                      arguments: toolCall.function?.arguments || '{}'
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })
      )
    })

    const finalChunk = {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: choice.finish_reason || (toolCalls.length > 0 ? 'tool_calls' : 'stop')
        }
      ]
    }

    if (responseBody.usage) {
      finalChunk.usage = responseBody.usage
    }

    events.push(toSSE(finalChunk))
    events.push('data: [DONE]\n\n')

    return events
  }

  async _handleAggregatedStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleClientDisconnect,
    req,
    requestMetadata = null,
    responseAdapter = null,
    tokenCacheContext = null
  ) {
    try {
      const aggregatedResult = await this._consumeSuccessfulStreamResponse(
        response,
        responseAdapter
      )
      const { responseBody } = aggregatedResult

      if (!responseBody || typeof responseBody !== 'object') {
        throw new Error('Failed to aggregate upstream stream response body')
      }

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      return this._handleNormalResponse(
        {
          status: response.status,
          data: responseBody
        },
        res,
        account,
        apiKeyData,
        requestedModel,
        req._serviceTier || null,
        null,
        requestMetadata,
        tokenCacheContext,
        req
      )
    } catch (error) {
      logger.error('Failed to aggregate OpenAI-Responses stream response:', {
        accountId: account?.id,
        message: error.message
      })

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      if (res.headersSent) {
        return res.end()
      }

      return res.status(502).json({
        error: {
          message: 'Failed to aggregate upstream stream response',
          type: 'upstream_stream_error'
        }
      })
    }
  }

  async _handleStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleClientDisconnect,
    req,
    requestMetadata = null,
    responseAdapter = null,
    tokenCacheContext = null,
    onStreamFinished = null
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    let usageData = null
    let actualModel = null
    let rateLimitDetected = false
    let rateLimitResetsInSeconds = null
    let streamEnded = false
    let streamFinished = false
    const streamCaptureState = this._createResponsesStreamCaptureState()
    const parser = new IncrementalSSEParser()

    const finalizeStream = async () => {
      if (streamFinished) {
        return
      }

      streamFinished = true
      req.removeListener('close', cleanup)
      req.removeListener('aborted', cleanup)

      if (typeof onStreamFinished === 'function') {
        try {
          await onStreamFinished()
        } catch (error) {
          logger.error('Failed to finalize OpenAI-Responses stream cleanup:', error)
        }
      }
    }

    const captureUsage = (eventData) => {
      if (!eventData || typeof eventData !== 'object') {
        return
      }

      this._captureResponsesStreamEvent(streamCaptureState, eventData)

      if (eventData.type === 'response.completed' && eventData.response) {
        if (eventData.response.model) {
          actualModel = eventData.response.model
          logger.debug(`Captured actual model from response.completed: ${actualModel}`)
        }

        if (eventData.response.usage) {
          usageData = eventData.response.usage
          logger.info('Successfully captured usage data from OpenAI-Responses:', {
            input_tokens: usageData.input_tokens,
            output_tokens: usageData.output_tokens,
            total_tokens: usageData.total_tokens
          })
        }
      }

      if (eventData.model) {
        actualModel = eventData.model
      }
      if (eventData.usage) {
        usageData = eventData.usage
      }

      if (eventData.error) {
        if (
          eventData.error.type === 'rate_limit_error' ||
          eventData.error.type === 'usage_limit_reached' ||
          eventData.error.type === 'rate_limit_exceeded'
        ) {
          rateLimitDetected = true
          if (eventData.error.resets_in_seconds) {
            rateLimitResetsInSeconds = eventData.error.resets_in_seconds
            logger.warn(
              `Rate limit detected in stream, resets in ${rateLimitResetsInSeconds} seconds (${Math.ceil(rateLimitResetsInSeconds / 60)} minutes)`
            )
          }
        }
      }
    }

    const writeChunk = (chunk) => {
      if (!res.destroyed && !streamEnded) {
        res.write(chunk)
      }
    }

    const flushParsedEvents = (events) => {
      for (const event of events) {
        if (event.type === 'data' && event.data) {
          captureUsage(event.data)
          if (responseAdapter) {
            responseAdapter.writeEvent(event.data, writeChunk)
          }
        }
      }
    }

    response.data.on('data', (chunk) => {
      try {
        const chunkStr = chunk.toString()

        if (!responseAdapter) {
          writeChunk(chunk)
        }

        flushParsedEvents(parser.feed(chunkStr))
      } catch (error) {
        logger.error('Error processing stream chunk:', error)
      }
    })

    response.data.on('end', async () => {
      streamEnded = true

      const remaining = parser.getRemaining()
      if (remaining.trim()) {
        flushParsedEvents(parser.feed('\n\n'))
      }

      if (responseAdapter?.finalizeStream && !res.destroyed) {
        responseAdapter.finalizeStream(writeChunk)
      }

      if (usageData) {
        try {
          const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
          const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
          const cacheReadTokens = extractOpenAICacheReadTokens(usageData)
          const cacheCreateTokens = extractCacheCreationTokens(usageData)
          const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

          const totalTokens =
            usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens
          const modelToRecord = actualModel || requestedModel || 'gpt-4'

          const serviceTier = req._serviceTier || null
          const requestMeta = {
            ...(requestMetadata || {}),
            ...createRequestDetailMeta(req, {
              requestBody: req.body,
              stream: true,
              statusCode: res.statusCode
            })
          }

          await apiKeyService.recordUsage(
            apiKeyData.id,
            actualInputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            modelToRecord,
            account.id,
            'openai-responses',
            serviceTier,
            requestMeta
          )

          logger.info(
            `Recorded usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${modelToRecord}`
          )
          tokenCacheMetricsService.recordAsync(
            buildProviderPromptCacheMetrics({ cacheReadTokens, cacheCreateTokens })
          )

          await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

          if (parseFloat(account.dailyQuota) > 0) {
            const CostCalculator = require('../../utils/costCalculator')
            const costInfo = CostCalculator.calculateCost(
              {
                input_tokens: actualInputTokens,
                output_tokens: outputTokens,
                cache_creation_input_tokens: cacheCreateTokens,
                cache_read_input_tokens: cacheReadTokens
              },
              modelToRecord,
              serviceTier
            )
            await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
          }
        } catch (error) {
          logger.error('Failed to record usage:', error)
        }
      }

      const cachedPayload =
        responseAdapter?.getFinalPayload?.() ||
        this._buildCapturedResponsesPayload(streamCaptureState, null) ||
        null
      if (cachedPayload && !rateLimitDetected) {
        await this._storeTokenCacheResponse(tokenCacheContext, {
          statusCode: response.status,
          body: cachedPayload,
          headers: response.headers,
          streamed: true
        })
      }

      if (rateLimitDetected) {
        const stableSessionKey =
          tokenCacheContext?.sessionKey || extractStableTokenCacheSessionKey(req, req.body)
        const sessionHash = stableSessionKey
          ? crypto.createHash('sha256').update(stableSessionKey).digest('hex')
          : null

        await unifiedOpenAIScheduler.markAccountRateLimited(
          account.id,
          'openai-responses',
          sessionHash,
          rateLimitResetsInSeconds
        )

        logger.warn(`Processing rate limit for OpenAI-Responses account ${account.id} from stream`)
      }

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)
      await finalizeStream()

      if (!res.destroyed) {
        res.end()
      }

      logger.info('Stream response completed', {
        accountId: account.id,
        hasUsage: !!usageData,
        actualModel: actualModel || 'unknown'
      })
    })

    response.data.on('error', async (error) => {
      streamEnded = true
      logger.error('Stream error:', error)

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)
      await finalizeStream()

      if (!res.headersSent) {
        res.status(502).json({ error: { message: 'Upstream stream error' } })
      } else if (!res.destroyed) {
        res.end()
      }
    })

    const cleanup = () => {
      streamEnded = true
      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)
      try {
        response.data?.unpipe?.(res)
        response.data?.destroy?.()
      } catch (_) {
        // ignore cleanup errors
      }
      void finalizeStream()
    }

    req.on('close', cleanup)
    req.on('aborted', cleanup)
  }

  async _handleNormalResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    serviceTier = null,
    responseAdapter = null,
    requestMetadata = null,
    tokenCacheContext = null,
    req = null
  ) {
    const responseData = response.data
    const usageData = responseData?.usage || responseData?.response?.usage
    const actualModel =
      responseData?.model || responseData?.response?.model || requestedModel || 'gpt-4'

    if (usageData) {
      try {
        const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
        const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
        const cacheReadTokens = extractOpenAICacheReadTokens(usageData)
        const cacheCreateTokens = extractCacheCreationTokens(usageData)
        const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

        const totalTokens =
          usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens

        const requestMeta = {
          ...(requestMetadata || {}),
          ...createRequestDetailMeta(req, {
            requestBody: req?.body,
            stream: false,
            statusCode: response.status
          })
        }

        await apiKeyService.recordUsage(
          apiKeyData.id,
          actualInputTokens,
          outputTokens,
          cacheCreateTokens,
          cacheReadTokens,
          actualModel,
          account.id,
          'openai-responses',
          serviceTier,
          requestMeta
        )

        logger.info(
          `Recorded non-stream usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${actualModel}`
        )
        tokenCacheMetricsService.recordAsync(
          buildProviderPromptCacheMetrics({ cacheReadTokens, cacheCreateTokens })
        )

        await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

        if (parseFloat(account.dailyQuota) > 0) {
          const CostCalculator = require('../../utils/costCalculator')
          const costInfo = CostCalculator.calculateCost(
            {
              input_tokens: actualInputTokens,
              output_tokens: outputTokens,
              cache_creation_input_tokens: cacheCreateTokens,
              cache_read_input_tokens: cacheReadTokens
            },
            actualModel,
            serviceTier
          )
          await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
        }
      } catch (error) {
        logger.error('Failed to record usage:', error)
      }
    }

    let clientPayload = responseData
    if (responseAdapter?.convertJson) {
      try {
        clientPayload = responseAdapter.convertJson(responseData)
      } catch (error) {
        logger.error('Failed to transform non-stream response:', error)
      }
    }

    await this._storeTokenCacheResponse(tokenCacheContext, {
      statusCode: response.status,
      body: clientPayload,
      headers: response.headers,
      streamed: false
    })

    logger.info('Normal response completed', {
      accountId: account.id,
      status: response.status,
      hasUsage: !!usageData,
      model: actualModel
    })

    return res.status(response.status).json(clientPayload)
  }

  async _handle429Error(account, response, isStream = false, sessionHash = null) {
    let resetsInSeconds = null
    let errorData = null

    try {
      // 对于429错误，响应可能是JSON或SSE格式
      if (isStream && response.data && typeof response.data.pipe === 'function') {
        // 流式响应需要先收集数据
        const chunks = []
        await new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => chunks.push(chunk))
          response.data.on('end', resolve)
          response.data.on('error', reject)
          // 设置超时防止无限等待
          setTimeout(resolve, 5000)
        })

        const fullResponse = Buffer.concat(chunks).toString()

        // 尝试解析SSE格式的错误响应
        if (fullResponse.includes('data: ')) {
          const lines = fullResponse.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6).trim()
                if (jsonStr && jsonStr !== '[DONE]') {
                  errorData = JSON.parse(jsonStr)
                  break
                }
              } catch (e) {
                // 继续尝试下一行
              }
            }
          }
        }

        // 如果SSE解析失败，尝试直接解析为JSON
        if (!errorData) {
          try {
            errorData = JSON.parse(fullResponse)
          } catch (e) {
            logger.error('Failed to parse 429 error response:', e)
            logger.debug('Raw response:', fullResponse)
          }
        }
      } else if (response.data && typeof response.data !== 'object') {
        // 如果response.data是字符串，尝试解析为JSON
        try {
          errorData = JSON.parse(response.data)
        } catch (e) {
          logger.error('Failed to parse 429 error response as JSON:', e)
          errorData = { error: { message: response.data } }
        }
      } else if (response.data && typeof response.data === 'object' && !response.data.pipe) {
        // 非流式响应，且是对象，直接使用
        errorData = response.data
      }

      // 从响应体中提取重置时间（OpenAI 标准格式）
      if (errorData && errorData.error) {
        if (errorData.error.resets_in_seconds) {
          resetsInSeconds = errorData.error.resets_in_seconds
          logger.info(
            `🕐 Rate limit will reset in ${resetsInSeconds} seconds (${Math.ceil(resetsInSeconds / 60)} minutes / ${Math.ceil(resetsInSeconds / 3600)} hours)`
          )
        } else if (errorData.error.resets_in) {
          // 某些 API 可能使用不同的字段名
          resetsInSeconds = parseInt(errorData.error.resets_in)
          logger.info(
            `🕐 Rate limit will reset in ${resetsInSeconds} seconds (${Math.ceil(resetsInSeconds / 60)} minutes / ${Math.ceil(resetsInSeconds / 3600)} hours)`
          )
        }
      }

      if (!resetsInSeconds) {
        logger.warn('⚠️ Could not extract reset time from 429 response, using default 60 minutes')
      }
    } catch (e) {
      logger.error('⚠️ Failed to parse rate limit error:', e)
    }

    // 使用统一调度器标记账户为限流状态（与普通OpenAI账号保持一致）
    await unifiedOpenAIScheduler.markAccountRateLimited(
      account.id,
      'openai-responses',
      sessionHash,
      resetsInSeconds
    )

    logger.warn('OpenAI-Responses account rate limited', {
      accountId: account.id,
      accountName: account.name,
      resetsInSeconds: resetsInSeconds || 'unknown',
      resetInMinutes: resetsInSeconds ? Math.ceil(resetsInSeconds / 60) : 60,
      resetInHours: resetsInSeconds ? Math.ceil(resetsInSeconds / 3600) : 1
    })

    // 返回处理后的数据，避免循环引用
    return { resetsInSeconds, errorData }
  }

  // 过滤请求头 - 已迁移到 headerFilter 工具类
  // 此方法保留用于向后兼容，实际使用 filterForOpenAI()
  _filterRequestHeaders(headers) {
    return filterForOpenAI(headers)
  }

  // 估算费用（简化版本，实际应该根据不同的定价模型）
  _estimateCost(model, inputTokens, outputTokens) {
    // 这是一个简化的费用估算，实际应该根据不同的 API 提供商和模型定价
    const rates = {
      'gpt-4': { input: 0.03, output: 0.06 }, // per 1K tokens
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 }
    }

    // 查找匹配的模型定价
    let rate = rates['gpt-3.5-turbo'] // 默认使用 GPT-3.5 的价格
    for (const [modelKey, modelRate] of Object.entries(rates)) {
      if (model.toLowerCase().includes(modelKey.toLowerCase())) {
        rate = modelRate
        break
      }
    }

    const inputCost = (inputTokens / 1000) * rate.input
    const outputCost = (outputTokens / 1000) * rate.output
    return inputCost + outputCost
  }
}

module.exports = new OpenAIResponsesRelayService(createDefaultTokenCacheProvider())
