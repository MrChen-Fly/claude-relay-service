function toSafeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function buildProviderPromptCacheMetrics({ cacheReadTokens = 0, cacheCreateTokens = 0 } = {}) {
  const readTokens = toSafeInteger(cacheReadTokens)
  const writeTokens = toSafeInteger(cacheCreateTokens)

  if (readTokens <= 0 && writeTokens <= 0) {
    return {}
  }

  return {
    providerPromptCacheRequests: 1,
    providerPromptCacheReadRequests: readTokens > 0 ? 1 : 0,
    providerPromptCacheWriteRequests: writeTokens > 0 ? 1 : 0,
    providerPromptCacheReadTokens: readTokens,
    providerPromptCacheWriteTokens: writeTokens
  }
}

module.exports = {
  buildProviderPromptCacheMetrics
}
