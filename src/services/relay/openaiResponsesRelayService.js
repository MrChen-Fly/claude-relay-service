const axios = require('axios')
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
  constructor() {
    this.defaultTimeout = config.requestTimeout || 600000
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

  // 处理请求转发
  async handleRequest(req, res, account, apiKeyData, options = {}) {
    let abortController = null
    const sessionId = req.headers['session_id'] || req.body?.session_id
    const sessionHash = sessionId
      ? crypto.createHash('sha256').update(sessionId).digest('hex')
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

        const targetPath = this._normalizeTargetPath(fullAccount.baseApi || '', attempt.path)
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

        if (response.status >= 400) {
          await this._consumeErrorResponseData(response)

          if (this._shouldRetryWithAlternateProtocol(response, index < attempts.length - 1)) {
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
        selectedAttempt.body?.stream &&
        response.data &&
        typeof response.data.pipe === 'function'
      ) {
        return this._handleStreamResponse(
          response,
          res,
          account,
          apiKeyData,
          selectedAttempt.requestedModel || selectedAttempt.body?.model,
          handleClientDisconnect,
          req,
          responseAdapter
        )
      }

      return this._handleNormalResponse(
        response,
        res,
        account,
        apiKeyData,
        selectedAttempt.requestedModel || selectedAttempt.body?.model,
        req._serviceTier || null,
        responseAdapter
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
    }
  }

  _buildAttempts(req, options = {}) {
    const attempts =
      Array.isArray(options.attempts) && options.attempts.length > 0
        ? options.attempts
        : [{ path: req.path, body: req.body, transform: 'passthrough' }]

    return attempts.map((attempt) => ({
      path: attempt.path || req.path,
      body: attempt.body || req.body,
      transform: attempt.transform || 'passthrough',
      requestedModel: attempt.requestedModel || attempt.body?.model || req.body?.model || null
    }))
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

  _normalizeTargetPath(baseApi, targetPath) {
    if (baseApi.endsWith('/v1') && targetPath.startsWith('/v1/')) {
      return targetPath.slice(3)
    }
    return targetPath
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

  _shouldRetryWithAlternateProtocol(response, hasAlternateAttempt) {
    if (!hasAlternateAttempt) {
      return false
    }

    if ([404, 405, 415, 501].includes(response.status)) {
      return true
    }

    if (![400, 403, 422].includes(response.status)) {
      return false
    }

    const errorData = response.data?.error || response.data || {}
    const haystack = `${errorData.code || ''} ${errorData.type || ''} ${errorData.message || ''}`
      .toLowerCase()
      .trim()

    if (!haystack) {
      return false
    }

    const retryPatterns = [
      /unsupported.*endpoint/,
      /unknown.*endpoint/,
      /unknown.*path/,
      /unknown.*url/,
      /no route/,
      /not found/,
      /illegal access/,
      /method not allowed/,
      /missing required parameter.*\b(messages|input)\b/,
      /\b(messages|input)\b.*\brequired\b/,
      /chat\/completions/,
      /\/responses\b/
    ]

    return retryPatterns.some((pattern) => pattern.test(haystack))
  }

  _createResponseAdapter(attempt = {}) {
    const requestedModel = attempt.requestedModel || attempt.body?.model || null

    if (attempt.transform === 'responses_to_chat') {
      const converter = new CodexToOpenAIConverter()
      const state = converter.createStreamState()

      return {
        convertJson: (payload) => converter.convertResponse(payload, requestedModel),
        writeEvent: (eventData, writeChunk) => {
          if (eventData?.error) {
            writeChunk(toSSE(eventData))
            return
          }

          const converted = converter.convertStreamChunk(eventData, requestedModel, state)
          for (const chunk of converted) {
            writeChunk(typeof chunk === 'string' ? chunk : toSSE(chunk))
          }
        },
        finalizeStream: (writeChunk) => {
          writeChunk('data: [DONE]\n\n')
        }
      }
    }

    if (attempt.transform === 'chat_to_responses') {
      const converter = new ChatToResponsesConverter()
      const state = converter.createStreamState()

      return {
        convertJson: (payload) => converter.convertResponse(payload, requestedModel),
        writeEvent: (eventData, writeChunk) => {
          if (eventData?.error) {
            writeChunk(toSSE(eventData))
            return
          }

          const convertedEvents = converter.convertStreamChunk(eventData, requestedModel, state)
          for (const event of convertedEvents) {
            writeChunk(toSSE(event))
          }
        }
      }
    }

    return null
  }

  async _handleStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleClientDisconnect,
    req,
    responseAdapter = null
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
    const parser = new IncrementalSSEParser()

    const captureUsage = (eventData) => {
      if (!eventData || typeof eventData !== 'object') {
        return
      }

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
          const cacheReadTokens = usageData.input_tokens_details?.cached_tokens || 0
          const cacheCreateTokens = extractCacheCreationTokens(usageData)
          const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

          const totalTokens =
            usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens
          const modelToRecord = actualModel || requestedModel || 'gpt-4'

          const serviceTier = req._serviceTier || null
          await apiKeyService.recordUsage(
            apiKeyData.id,
            actualInputTokens,
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            modelToRecord,
            account.id,
            'openai-responses',
            serviceTier
          )

          logger.info(
            `Recorded usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${modelToRecord}`
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

      if (rateLimitDetected) {
        const sessionId = req.headers['session_id'] || req.body?.session_id
        const sessionHash = sessionId
          ? crypto.createHash('sha256').update(sessionId).digest('hex')
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

      if (!res.destroyed) {
        res.end()
      }

      logger.info('Stream response completed', {
        accountId: account.id,
        hasUsage: !!usageData,
        actualModel: actualModel || 'unknown'
      })
    })

    response.data.on('error', (error) => {
      streamEnded = true
      logger.error('Stream error:', error)

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      if (!res.headersSent) {
        res.status(502).json({ error: { message: 'Upstream stream error' } })
      } else if (!res.destroyed) {
        res.end()
      }
    })

    const cleanup = () => {
      streamEnded = true
      try {
        response.data?.unpipe?.(res)
        response.data?.destroy?.()
      } catch (_) {
        // ignore cleanup errors
      }
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
    responseAdapter = null
  ) {
    const responseData = response.data
    const usageData = responseData?.usage || responseData?.response?.usage
    const actualModel =
      responseData?.model || responseData?.response?.model || requestedModel || 'gpt-4'

    if (usageData) {
      try {
        const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
        const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
        const cacheReadTokens = usageData.input_tokens_details?.cached_tokens || 0
        const cacheCreateTokens = extractCacheCreationTokens(usageData)
        const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

        const totalTokens =
          usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens

        await apiKeyService.recordUsage(
          apiKeyData.id,
          actualInputTokens,
          outputTokens,
          cacheCreateTokens,
          cacheReadTokens,
          actualModel,
          account.id,
          'openai-responses',
          serviceTier
        )

        logger.info(
          `Recorded non-stream usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${actualModel}`
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

    return res.status(response.status).json(clientPayload)

    logger.info('Normal response completed', {
      accountId: account.id,
      status: response.status,
      hasUsage: !!usageData,
      model: actualModel
    })
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

module.exports = new OpenAIResponsesRelayService()
