const axios = require('axios')
const openaiResponsesAccountService = require('../account/openaiResponsesAccountService')
const { inferAccountCapabilities } = require('./capabilityProfile')
const { createOpenAITestPayload, extractErrorMessage } = require('../../utils/testPayloadHelper')
const ProxyHelper = require('../../utils/proxyHelper')
const logger = require('../../utils/logger')
const {
  buildResponsesClientAttempts,
  normalizeTargetPath,
  shouldRetryWithAlternateProtocol
} = require('./upstreamProtocolHelper')

function createCapabilitySchema() {
  return {
    type: 'object',
    properties: {
      ok: {
        type: 'string'
      }
    },
    required: ['ok'],
    additionalProperties: false
  }
}

class OpenAIResponsesUpstreamProbeService {
  constructor() {
    this.defaultTimeout = 30000
  }

  async probeAccount(accountOrId, { model = 'gpt-4o-mini' } = {}) {
    const account =
      typeof accountOrId === 'string'
        ? await openaiResponsesAccountService.getAccount(accountOrId)
        : accountOrId

    if (!account) {
      const error = new Error('Account not found')
      error.statusCode = 404
      throw error
    }

    if (!account.apiKey) {
      const error = new Error('API Key not found or decryption failed')
      error.statusCode = 401
      throw error
    }

    const resolvedModel = openaiResponsesAccountService.getMappedModel(
      account.modelMapping || account.supportedModels,
      model
    )

    const { primaryProbe, supportsNonStreamingResponses } =
      await this._probePrimaryNonStreamingResponses(account, resolvedModel)
    const capabilities = await this._probeCapabilities(account, resolvedModel, {
      supportsNonStreamingResponses
    })

    await openaiResponsesAccountService.updateAccount(account.id, { ...capabilities })

    return {
      accountId: account.id,
      accountName: account.name,
      model,
      resolvedModel,
      latency: primaryProbe.latency,
      responseText: primaryProbe.responseText.slice(0, 200),
      selectedUpstreamPath: primaryProbe.selectedUpstreamPath,
      fallbackUsed: primaryProbe.fallbackUsed,
      capabilities
    }
  }

  async _probePrimaryNonStreamingResponses(account, model) {
    try {
      return {
        primaryProbe: await this._runProbe(account, {
          model,
          body: createOpenAITestPayload(model, {
            prompt: 'Reply with OK only.',
            maxTokens: 64,
            stream: false
          })
        }),
        supportsNonStreamingResponses: true
      }
    } catch (error) {
      if (!this._isNonStreamingResponsesUnsupported(error)) {
        throw error
      }

      logger.warn('Primary non-stream responses probe is not supported, retrying with stream', {
        accountId: account.id,
        message: error.message
      })

      return {
        primaryProbe: await this._runProbe(account, {
          model,
          body: createOpenAITestPayload(model, {
            prompt: 'Reply with OK only.',
            maxTokens: 64,
            stream: true
          }),
          responseMode: 'stream'
        }),
        supportsNonStreamingResponses: false
      }
    }
  }

  async _probeCapabilities(account, model, overrides = {}) {
    const defaults = inferAccountCapabilities(account, 'openai-responses')
    const supportsStreaming = await this._probeCapability(
      account,
      model,
      {
        body: createOpenAITestPayload(model, {
          prompt: 'Reply with OK only.',
          maxTokens: 32,
          stream: true
        }),
        responseMode: 'stream',
        capability: 'streaming'
      },
      defaults.supportsStreaming
    )
    const supportsTools = await this._probeCapability(
      account,
      model,
      {
        body: {
          model,
          input: [
            {
              role: 'user',
              content: 'Call the echo tool with {"text":"OK"} and stop.'
            }
          ],
          max_output_tokens: 32,
          stream: false,
          tools: [
            {
              type: 'function',
              name: 'echo',
              description: 'Echo text back.',
              parameters: {
                type: 'object',
                properties: {
                  text: {
                    type: 'string'
                  }
                },
                required: ['text'],
                additionalProperties: false
              },
              strict: true
            }
          ],
          tool_choice: {
            type: 'function',
            name: 'echo'
          }
        },
        capability: 'tools'
      },
      defaults.supportsTools
    )
    const supportsReasoning = await this._probeCapability(
      account,
      model,
      {
        body: {
          model,
          input: [
            {
              role: 'user',
              content: 'Think briefly and reply with OK only.'
            }
          ],
          max_output_tokens: 32,
          stream: false,
          reasoning: {
            effort: 'low'
          }
        },
        capability: 'reasoning'
      },
      defaults.supportsReasoning
    )
    const supportsJsonSchema = await this._probeCapability(
      account,
      model,
      {
        body: {
          model,
          input: [
            {
              role: 'user',
              content: 'Return {"ok":"yes"} as JSON.'
            }
          ],
          max_output_tokens: 64,
          stream: false,
          text: {
            format: {
              type: 'json_schema',
              name: 'probe_response',
              strict: true,
              schema: createCapabilitySchema()
            }
          }
        },
        capability: 'json_schema'
      },
      defaults.supportsJsonSchema
    )

    return {
      supportsNonStreamingResponses:
        overrides.supportsNonStreamingResponses ?? defaults.supportsNonStreamingResponses,
      supportsStreaming,
      supportsTools,
      supportsReasoning,
      supportsJsonSchema
    }
  }

  async _probeCapability(account, model, probeOptions, fallbackValue) {
    try {
      const result = await this._runProbe(account, {
        model,
        body: probeOptions.body,
        responseMode: probeOptions.responseMode || 'json'
      })

      if (probeOptions.responseMode === 'stream') {
        return result.isSSE === true
      }

      return true
    } catch (error) {
      if (this._isCapabilityUnsupported(error)) {
        return false
      }

      logger.warn('Capability probe failed, keep inferred capability', {
        accountId: account.id,
        capability: probeOptions.capability,
        message: error.message
      })
      return fallbackValue
    }
  }

  async _runProbe(account, { model, body, responseMode = 'json' }) {
    const providerEndpoint = openaiResponsesAccountService.normalizeProviderEndpoint(
      account.providerEndpoint
    )
    const attempts = buildResponsesClientAttempts({
      path: '/v1/responses',
      body,
      requestedModel: model,
      providerEndpoint
    })

    let response = null
    let selectedAttempt = attempts[0]
    const startedAt = Date.now()

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]
      selectedAttempt = attempt
      response = await axios(this._buildRequestConfig(account, attempt, responseMode))

      if (response.status >= 400) {
        response.data = await this._consumeResponseData(response)

        if (shouldRetryWithAlternateProtocol(response, index < attempts.length - 1)) {
          continue
        }

        throw this._buildProbeError(response, attempt)
      }

      break
    }

    const latency = Date.now() - startedAt

    if (responseMode === 'stream') {
      const streamResult = await this._consumeSuccessStream(response)
      return {
        latency,
        responseText: streamResult.responseText,
        selectedUpstreamPath: selectedAttempt.path,
        fallbackUsed: selectedAttempt.path !== attempts[0].path,
        isSSE: streamResult.isSSE
      }
    }

    return {
      latency,
      responseText: this._extractResponseText(response.data),
      selectedUpstreamPath: selectedAttempt.path,
      fallbackUsed: selectedAttempt.path !== attempts[0].path,
      isSSE: false
    }
  }

  _buildRequestConfig(account, attempt, responseMode) {
    const targetPath = normalizeTargetPath(account.baseApi || '', attempt.path)
    const requestConfig = {
      method: 'POST',
      url: `${account.baseApi || 'https://api.openai.com'}${targetPath}`,
      data: attempt.body,
      timeout: this.defaultTimeout,
      responseType: responseMode === 'stream' ? 'stream' : 'json',
      validateStatus: () => true,
      headers: {
        Authorization: `Bearer ${account.apiKey}`,
        'Content-Type': 'application/json'
      }
    }

    if (account.userAgent) {
      requestConfig.headers['User-Agent'] = account.userAgent
    }

    if (account.proxy) {
      const agent = ProxyHelper.createProxyAgent(account.proxy)
      if (agent) {
        requestConfig.httpAgent = agent
        requestConfig.httpsAgent = agent
        requestConfig.proxy = false
      }
    }

    return requestConfig
  }

  async _consumeResponseData(response) {
    if (!response?.data || typeof response.data.pipe !== 'function') {
      return response?.data
    }

    const chunks = []
    await new Promise((resolve) => {
      response.data.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.data.on('end', resolve)
      response.data.on('error', resolve)
      setTimeout(resolve, 5000)
    })

    const rawResponse = Buffer.concat(chunks).toString()
    const ssePayloads = this._extractSSEPayloads(rawResponse)

    if (ssePayloads.length > 0) {
      const firstPayload = ssePayloads.find((payload) => payload !== '[DONE]')
      if (firstPayload) {
        try {
          return JSON.parse(firstPayload)
        } catch (_) {
          return { error: { message: rawResponse } }
        }
      }
    }

    try {
      return JSON.parse(rawResponse)
    } catch (_) {
      return { error: { message: rawResponse || 'Unknown error' } }
    }
  }

  async _consumeSuccessStream(response) {
    const chunks = []
    await new Promise((resolve) => {
      response.data.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.data.on('end', resolve)
      response.data.on('error', resolve)
      setTimeout(resolve, 5000)
    })

    const rawResponse = Buffer.concat(chunks).toString()
    const ssePayloads = this._extractSSEPayloads(rawResponse)
    let responseText = ''

    for (const payload of ssePayloads) {
      if (!payload || payload === '[DONE]') {
        continue
      }

      try {
        const eventData = JSON.parse(payload)
        responseText += this._extractStreamText(eventData)
      } catch (_) {
        // Ignore malformed SSE chunks during probing.
      }
    }

    return {
      isSSE: ssePayloads.length > 0,
      responseText
    }
  }

  _extractSSEPayloads(rawResponse = '') {
    return rawResponse
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
  }

  _extractStreamText(eventData = {}) {
    if (typeof eventData.delta === 'string') {
      return eventData.delta
    }

    if (Array.isArray(eventData.choices)) {
      const content = eventData.choices[0]?.delta?.content
      if (typeof content === 'string') {
        return content
      }
      if (Array.isArray(content)) {
        return content
          .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
          .join('')
      }
    }

    if (eventData.type === 'response.completed' && eventData.response) {
      return this._extractResponseText(eventData.response)
    }

    if (eventData.type === 'response.output_text.delta') {
      if (typeof eventData.delta === 'string') {
        return eventData.delta
      }
      if (typeof eventData.delta?.text === 'string') {
        return eventData.delta.text
      }
    }

    if (typeof eventData.text === 'string') {
      return eventData.text
    }

    return ''
  }

  _extractResponseText(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return ''
    }

    if (typeof payload.output_text === 'string') {
      return payload.output_text
    }

    if (Array.isArray(payload.choices)) {
      const content = payload.choices[0]?.message?.content
      if (typeof content === 'string') {
        return content
      }
      if (Array.isArray(content)) {
        return content
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return ''
            }

            return item.text || item.output_text || ''
          })
          .join('')
      }
    }

    if (Array.isArray(payload.output)) {
      return payload.output
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return ''
          }

          if (Array.isArray(item.content)) {
            return item.content
              .map((block) => {
                if (!block || typeof block !== 'object') {
                  return ''
                }

                return block.text || block.output_text || ''
              })
              .join('')
          }

          return ''
        })
        .join('')
    }

    if (payload.response) {
      return this._extractResponseText(payload.response)
    }

    return ''
  }

  _buildProbeError(response, attempt) {
    const message = extractErrorMessage(
      response?.data,
      response?.statusText || 'OpenAI-Responses account test failed'
    )
    const error = new Error(message)
    error.statusCode = response?.status || 500
    error.response = response
    error.attemptPath = attempt?.path
    return error
  }

  _isCapabilityUnsupported(error) {
    const status = error?.statusCode || error?.response?.status
    if ([400, 403, 404, 405, 415, 422, 501].includes(status)) {
      return true
    }

    const errorData = error?.response?.data?.error || error?.response?.data || {}
    const haystack = `${errorData.code || ''} ${errorData.type || ''} ${
      errorData.detail || ''
    } ${errorData.message || ''} ${error?.message || ''}`
      .toLowerCase()
      .trim()

    if (!haystack) {
      return false
    }

    const unsupportedPatterns = [
      /unsupported/,
      /not supported/,
      /unknown parameter/,
      /unknown field/,
      /invalid parameter/,
      /invalid request/,
      /json_schema/,
      /tool_choice/,
      /reasoning/,
      /stream/
    ]

    return unsupportedPatterns.some((pattern) => pattern.test(haystack))
  }

  _isNonStreamingResponsesUnsupported(error) {
    const status = error?.statusCode || error?.response?.status
    if (![400, 403, 422].includes(status)) {
      return false
    }

    const errorData = error?.response?.data?.error || error?.response?.data || {}
    const haystack = `${errorData.code || ''} ${errorData.type || ''} ${
      errorData.detail || ''
    } ${errorData.message || ''} ${error?.message || ''}`
      .toLowerCase()
      .trim()

    if (!haystack) {
      return false
    }

    return (
      /stream must be set to true/.test(haystack) ||
      (/non[- ]?stream/.test(haystack) && /not supported|unsupported|required/.test(haystack)) ||
      (/responses/.test(haystack) && /streaming required/.test(haystack))
    )
  }
}

module.exports = new OpenAIResponsesUpstreamProbeService()
