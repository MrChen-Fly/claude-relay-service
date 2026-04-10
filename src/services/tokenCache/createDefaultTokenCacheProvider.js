const config = require('../../../config/config')
const { NoopTokenCacheProvider } = require('./tokenCacheProvider')
const RedisTokenCacheStorage = require('./redisTokenCacheStorage')
const PromptCacheTokenCacheProvider = require('./promptCacheTokenCacheProvider')
const OpenAISemanticProvider = require('./openAISemanticProvider')
const SemanticTokenCacheEngine = require('./semanticTokenCacheEngine')
const StorageBackedToolResultCacheProvider = require('./storageBackedToolResultCacheProvider')
const tokenCacheMetricsService = require('./tokenCacheMetricsService')
const tokenCacheDiagnosticsService = require('./tokenCacheDiagnosticsService')

function createDefaultTokenCacheProvider() {
  const tokenCacheConfig = config.tokenCache
  if (!tokenCacheConfig?.enabled) {
    return new NoopTokenCacheProvider()
  }

  const storage = new RedisTokenCacheStorage({
    namespace: tokenCacheConfig.namespace
  })

  let semanticEngine = null
  let toolResultCacheProvider = null
  if (tokenCacheConfig.semanticEnabled) {
    const semanticProvider = new OpenAISemanticProvider({
      apiKey: tokenCacheConfig.openaiApiKey,
      baseUrl: tokenCacheConfig.openaiBaseUrl,
      embedModel: tokenCacheConfig.openaiEmbedModel,
      maxInputChars: tokenCacheConfig.openaiEmbedMaxInputChars,
      maxInputBytes: tokenCacheConfig.openaiEmbedMaxInputBytes,
      inputStrategyName: tokenCacheConfig.openaiEmbedInputStrategy,
      chunkMaxChunks: tokenCacheConfig.openaiEmbedChunkMaxChunks,
      chunkOverlapChars: tokenCacheConfig.openaiEmbedChunkOverlapChars,
      verifyModel: tokenCacheConfig.openaiVerifyModel,
      timeout: tokenCacheConfig.requestTimeoutMs,
      metrics: tokenCacheMetricsService
    })

    if (semanticProvider.isEnabled()) {
      semanticEngine = new SemanticTokenCacheEngine(storage, semanticProvider, {
        highThreshold: tokenCacheConfig.highThreshold,
        lowThreshold: tokenCacheConfig.lowThreshold,
        enableGrayZoneVerifier: tokenCacheConfig.enableGrayZoneVerifier,
        useANNIndex: tokenCacheConfig.useANNIndex,
        metrics: tokenCacheMetricsService
      })
    }
  }

  if (
    tokenCacheConfig.toolResultEnabled &&
    Array.isArray(tokenCacheConfig.toolResultAllowedTools) &&
    tokenCacheConfig.toolResultAllowedTools.length > 0
  ) {
    toolResultCacheProvider = new StorageBackedToolResultCacheProvider({
      storage,
      enabled: tokenCacheConfig.toolResultEnabled,
      ttlSeconds: tokenCacheConfig.toolResultTtlSeconds,
      allowedTools: tokenCacheConfig.toolResultAllowedTools
    })
  }

  return new PromptCacheTokenCacheProvider({
    storage,
    semanticEngine,
    toolResultCacheProvider,
    config: tokenCacheConfig,
    metrics: tokenCacheMetricsService,
    diagnostics: tokenCacheDiagnosticsService
  })
}

module.exports = createDefaultTokenCacheProvider
