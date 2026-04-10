/**
 * Base contract for future tool-result cache implementations.
 */
class ToolResultCacheProvider {
  getName() {
    return 'custom'
  }

  isEnabled() {
    return true
  }

  async lookupCandidates(_context, _candidates = []) {
    return { hit: false }
  }

  async storeCandidates(_context, _candidates = [], _response = null) {
    return { stored: false }
  }
}

/**
 * Default no-op implementation so the token-cache chain can expose a stable hook.
 */
class NoopToolResultCacheProvider extends ToolResultCacheProvider {
  getName() {
    return 'noop'
  }

  isEnabled() {
    return false
  }
}

module.exports = {
  ToolResultCacheProvider,
  NoopToolResultCacheProvider
}
