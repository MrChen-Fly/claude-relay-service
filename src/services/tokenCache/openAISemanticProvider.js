const axios = require('axios')
const { EmbeddingModelInfoResolver } = require('./embeddingModelInfoResolver')
const { createSemanticInputStrategy } = require('./semanticInputStrategy')
const {
  SemanticInputTooLargeError,
  isSemanticInputTooLargeError
} = require('./semanticProviderErrors')

class OpenAISemanticProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || ''
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1'
    this.embedModel = options.embedModel || 'text-embedding-3-small'
    this.verifyModel = options.verifyModel || 'gpt-4o-mini'
    this.timeout = Number.parseInt(options.timeout, 10) || 30000
    this.maxInputChars = Number.parseInt(options.maxInputChars, 10) || 0
    this.maxInputBytes = Number.parseInt(options.maxInputBytes, 10) || 0
    this.inputStrategy =
      options.inputStrategy && typeof options.inputStrategy.embed === 'function'
        ? options.inputStrategy
        : createSemanticInputStrategy({
            name: options.inputStrategyName || options.inputStrategy || 'skip',
            maxInputChars: this.maxInputChars,
            chunkMaxChunks: options.chunkMaxChunks,
            chunkOverlapChars: options.chunkOverlapChars
          })
    this.metrics = options.metrics || null
    this.modelInfoResolver =
      options.modelInfoResolver ||
      new EmbeddingModelInfoResolver({
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        timeout: this.timeout,
        ttlMs: options.modelInfoTtlMs
      })
  }

  isEnabled() {
    return Boolean(this.apiKey)
  }

  _recordMetrics(fields = {}) {
    if (!this.metrics?.recordAsync) {
      return
    }

    this.metrics.recordAsync(fields)
  }

  _buildInputDiagnostics(text) {
    const normalizedText = typeof text === 'string' ? text : String(text || '')
    return {
      text: normalizedText,
      charCount: normalizedText.length,
      byteCount: Buffer.byteLength(normalizedText, 'utf8')
    }
  }

  _recordSemanticSkip(reason) {
    this._recordMetrics({
      semanticSkips: 1,
      [`semanticSkipReason:${reason || 'unknown'}`]: 1
    })
  }

  _createInputTooLargeError(reason, message, diagnostics = {}, extraDetails = {}, limits = {}) {
    const effectiveMaxInputChars = Number.parseInt(limits.maxInputChars, 10) || this.maxInputChars
    const effectiveMaxInputBytes = Number.parseInt(limits.maxInputBytes, 10) || this.maxInputBytes
    return new SemanticInputTooLargeError(message, {
      reason,
      details: {
        model: this.embedModel,
        baseUrl: this.baseUrl,
        charCount: diagnostics.charCount || 0,
        byteCount: diagnostics.byteCount || 0,
        maxInputChars: effectiveMaxInputChars,
        maxInputBytes: effectiveMaxInputBytes,
        ...extraDetails
      }
    })
  }

  async _resolveEffectiveMaxInputChars() {
    if (this.maxInputChars > 0) {
      return this.maxInputChars
    }

    if (this.inputStrategy?.name !== 'chunked_mean' || !this.modelInfoResolver?.resolve) {
      return 0
    }

    const modelInfo = await this.modelInfoResolver.resolve(this.embedModel)
    return Number.parseInt(modelInfo?.recommendedMaxInputChars, 10) || 0
  }

  _getConfiguredInputLimitError(diagnostics = {}, limits = {}) {
    const effectiveMaxInputChars = Number.parseInt(limits.maxInputChars, 10) || this.maxInputChars
    const effectiveMaxInputBytes = Number.parseInt(limits.maxInputBytes, 10) || this.maxInputBytes

    if (effectiveMaxInputChars > 0 && diagnostics.charCount > effectiveMaxInputChars) {
      return this._createInputTooLargeError(
        'input_too_large_config_chars',
        `semantic input exceeds configured maxInputChars (${effectiveMaxInputChars})`,
        diagnostics,
        {},
        {
          maxInputChars: effectiveMaxInputChars,
          maxInputBytes: effectiveMaxInputBytes
        }
      )
    }

    if (effectiveMaxInputBytes > 0 && diagnostics.byteCount > effectiveMaxInputBytes) {
      return this._createInputTooLargeError(
        'input_too_large_config_bytes',
        `semantic input exceeds configured maxInputBytes (${effectiveMaxInputBytes})`,
        diagnostics,
        {},
        {
          maxInputChars: effectiveMaxInputChars,
          maxInputBytes: effectiveMaxInputBytes
        }
      )
    }

    return null
  }

  _normalizeEmbeddingError(error, diagnostics = {}) {
    if (isSemanticInputTooLargeError(error)) {
      return error
    }

    const status = Number(error?.response?.status) || 0
    const providerData =
      error?.response?.data && typeof error.response.data === 'object' ? error.response.data : {}
    const providerMessage =
      typeof providerData.message === 'string'
        ? providerData.message
        : typeof error?.message === 'string'
          ? error.message
          : ''

    if (
      status === 413 ||
      /input must have less than \d+ tokens/i.test(providerMessage) ||
      providerData.code === 20042
    ) {
      return this._createInputTooLargeError(
        'input_too_large_provider',
        providerMessage || 'semantic provider rejected input as too large',
        diagnostics,
        {
          providerStatus: status,
          providerCode: providerData.code || null,
          providerMessage
        }
      )
    }

    return error
  }

  _shouldRetryWithSmallerChunk(error, diagnostics = {}) {
    if (isSemanticInputTooLargeError(error)) {
      return error.reason === 'input_too_large_provider'
    }

    const status = Number(error?.response?.status) || 0
    const providerData =
      error?.response?.data && typeof error.response.data === 'object' ? error.response.data : {}
    const providerMessage =
      typeof providerData.message === 'string'
        ? providerData.message
        : typeof error?.message === 'string'
          ? error.message
          : ''

    if (
      status === 413 ||
      /input must have less than \d+ tokens/i.test(providerMessage) ||
      providerData.code === 20042
    ) {
      return true
    }

    return status === 400 && providerData.code === 20015 && (diagnostics.charCount || 0) > 1
  }

  async _requestEmbedding(text) {
    const diagnostics = this._buildInputDiagnostics(text)
    this._recordMetrics({
      providerCalls: 1
    })

    const response = await axios.post(
      `${this.baseUrl}/embeddings`,
      {
        input: diagnostics.text,
        model: this.embedModel
      },
      {
        timeout: this.timeout,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )

    return response.data?.data?.[0]?.embedding || []
  }

  async embed(text) {
    if (!this.isEnabled()) {
      throw new Error(
        'TOKEN_CACHE_OPENAI_API_KEY or OPENAI_API_KEY is required for token cache semantic embedding'
      )
    }

    const diagnostics = this._buildInputDiagnostics(text)
    const effectiveMaxInputChars = await this._resolveEffectiveMaxInputChars()
    const effectiveLimits = {
      maxInputChars: effectiveMaxInputChars,
      maxInputBytes: this.maxInputBytes
    }
    const limitError = this._getConfiguredInputLimitError(diagnostics, effectiveLimits)

    try {
      return await this.inputStrategy.embed({
        text: diagnostics.text,
        diagnostics,
        preflightLimitError: limitError,
        maxInputChars: effectiveMaxInputChars,
        requestEmbedding: async (chunkText) => {
          try {
            return await this._requestEmbedding(chunkText)
          } catch (error) {
            throw this._normalizeEmbeddingError(error, this._buildInputDiagnostics(chunkText))
          }
        },
        createInputTooLargeError: (reason, message, extraDetails = {}) =>
          this._createInputTooLargeError(
            reason,
            message,
            diagnostics,
            extraDetails,
            effectiveLimits
          ),
        recordMetrics: (fields = {}) => this._recordMetrics(fields),
        shouldRetryWithSmallerChunk: (error, chunkDiagnostics = {}) =>
          this._shouldRetryWithSmallerChunk(error, chunkDiagnostics)
      })
    } catch (error) {
      const normalizedError = this._normalizeEmbeddingError(error, diagnostics)
      if (isSemanticInputTooLargeError(normalizedError)) {
        this._recordSemanticSkip(normalizedError.reason)
        throw normalizedError
      }

      this._recordMetrics({
        providerErrors: 1
      })
      throw normalizedError
    }
  }

  async checkSimilarity(prompt1, prompt2) {
    if (!this.isEnabled()) {
      return false
    }

    this._recordMetrics({
      providerCalls: 1
    })

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.verifyModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a semantic judge. Determine whether two prompts have the same intent and expected answer. Reply only YES or NO.'
            },
            {
              role: 'user',
              content: `Prompt 1: ${prompt1}\nPrompt 2: ${prompt2}`
            }
          ]
        },
        {
          timeout: this.timeout,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      const content =
        response.data?.choices?.[0]?.message?.content ||
        response.data?.choices?.[0]?.message?.content?.[0]?.text ||
        ''

      return String(content).trim().toUpperCase() === 'YES'
    } catch (error) {
      this._recordMetrics({
        providerErrors: 1
      })
      throw error
    }
  }
}

module.exports = OpenAISemanticProvider
