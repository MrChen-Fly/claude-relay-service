const crypto = require('crypto')
const { stableStringify } = require('./requestCacheFingerprint')
const { ToolResultCacheProvider } = require('./toolResultCacheProvider')

function normalizeToolName(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeAllowedTools(allowedTools = []) {
  return new Set(
    (Array.isArray(allowedTools) ? allowedTools : [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean)
  )
}

function normalizeEndpointPath(endpointPath = '') {
  return String(endpointPath || '').replace(/^\/v1\//, '/')
}

class StorageBackedToolResultCacheProvider extends ToolResultCacheProvider {
  constructor(options = {}) {
    super()
    this.storage = options.storage || null
    this.enabled = options.enabled !== false
    this.ttlSeconds = Number.parseInt(options.ttlSeconds, 10) || 0
    this.allowedTools = normalizeAllowedTools(options.allowedTools)
  }

  getName() {
    return 'tool-result-storage'
  }

  isEnabled() {
    return (
      this.enabled &&
      this.allowedTools.size > 0 &&
      this.storage &&
      typeof this.storage.get === 'function' &&
      typeof this.storage.set === 'function'
    )
  }

  _buildReplayPlan(context = {}, candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null
    }

    const normalizedCandidates = candidates.map((candidate) => ({
      toolName: normalizeToolName(candidate?.toolName),
      canonicalArguments: candidate?.canonicalArguments || '',
      canonicalOutput: candidate?.canonicalOutput || '',
      toolSchemaFingerprint: candidate?.toolSchemaFingerprint || ''
    }))

    const allCandidatesReplaySafe = normalizedCandidates.every(
      (candidate) =>
        candidate.toolName &&
        this.allowedTools.has(candidate.toolName) &&
        candidate.canonicalArguments &&
        candidate.canonicalOutput &&
        candidate.toolSchemaFingerprint
    )

    if (!allCandidatesReplaySafe) {
      return null
    }

    const key = crypto
      .createHash('sha256')
      .update(
        stableStringify({
          accountId: context.accountId || null,
          accountType: context.accountType || null,
          endpointPath: normalizeEndpointPath(context.endpointPath),
          requestedModel: context.requestedModel || context.requestBody?.model || null,
          candidates: normalizedCandidates
        })
      )
      .digest('hex')

    return {
      key,
      candidates: normalizedCandidates
    }
  }

  async lookupCandidates(context = {}, candidates = []) {
    if (!this.isEnabled()) {
      return { hit: false, reason: 'disabled' }
    }

    const replayPlan = this._buildReplayPlan(context, candidates)
    if (!replayPlan) {
      return { hit: false, reason: 'not_replay_safe' }
    }

    const entry = await this.storage.get('tool_result_entry', replayPlan.key)
    if (!entry || typeof entry !== 'object') {
      return { hit: false, reason: 'cache_miss' }
    }

    return {
      hit: true,
      layer: 'tool_result',
      statusCode: Number.parseInt(entry.statusCode, 10) || 200,
      body: entry.body,
      headers: {
        'x-token-cache-tool-result': 'HIT',
        'x-token-cache-tool-result-provider': this.getName(),
        'x-token-cache-tool-result-candidates': String(replayPlan.candidates.length)
      },
      cacheKey: replayPlan.key
    }
  }

  async storeCandidates(context = {}, candidates = [], response = null) {
    if (!this.isEnabled()) {
      return { stored: false, reason: 'disabled' }
    }

    if (!response || response.body === undefined) {
      return { stored: false, reason: 'empty_response' }
    }

    const replayPlan = this._buildReplayPlan(context, candidates)
    if (!replayPlan) {
      return { stored: false, reason: 'not_replay_safe' }
    }

    const statusCode = Number.parseInt(response.statusCode ?? response.status, 10) || 200
    const entry = {
      statusCode,
      body: response.body,
      toolNames: replayPlan.candidates.map((candidate) => candidate.toolName),
      candidateCount: replayPlan.candidates.length,
      createdAt: Date.now(),
      ttlSeconds: this.ttlSeconds
    }

    await this.storage.set('tool_result_entry', replayPlan.key, entry, this.ttlSeconds)

    return {
      stored: true,
      cacheKey: replayPlan.key,
      candidateCount: replayPlan.candidates.length
    }
  }
}

module.exports = StorageBackedToolResultCacheProvider
