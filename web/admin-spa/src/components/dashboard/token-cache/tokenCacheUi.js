import { formatNumber } from '@/utils/tools'

const BYPASS_REASON_LABELS = {
  dynamic_tools: '包含工具调用，跳过语义复用',
  structured_output: '启用了结构化输出',
  non_deterministic_temperature: '温度参数非 0，结果不稳定',
  empty_prompt: '提示词为空',
  unknown: '未知原因'
}

const SEMANTIC_SKIP_REASON_LABELS = {
  input_too_large_provider: '上游判定输入过长',
  input_too_large_config_chars: '超过字符上限',
  input_too_large_config_bytes: '超过字节上限',
  input_too_large_chunk_count: '分块数量超过限制',
  input_too_large_chunking_requires_char_limit: '缺少字符上限，无法分块',
  input_too_large_chunking_requires_chunk_limit: '缺少分块上限，无法分块',
  unknown: '未知原因'
}

const INPUT_STRATEGY_LABELS = {
  skip: '超限直接跳过',
  chunked_mean: '分块向量均值'
}

function prettifyFallbackReason(reason = '') {
  const normalized = String(reason || '').trim()
  if (!normalized) {
    return '未知原因'
  }

  return normalized.replace(/_/g, ' ')
}

export function formatTokenCacheModeLabel(config = {}) {
  if (!config?.enabled) {
    return '已关闭'
  }

  const semanticEnabled = Boolean(config?.semanticEnabled)
  const toolResultEnabled = Boolean(config?.toolResultEnabled)

  if (semanticEnabled && toolResultEnabled) {
    return '纯文本走语义复用，工具请求走精确命中并复用结果'
  }

  if (semanticEnabled) {
    return '纯文本优先语义复用'
  }

  if (toolResultEnabled) {
    return '仅精确命中，并保留工具结果复用'
  }

  return '仅精确命中'
}

export function formatTokenCacheModeShortLabel(config = {}) {
  if (!config?.enabled) {
    return '已关闭'
  }

  return config?.semanticEnabled ? '语义复用' : '精确命中'
}

export function formatTokenCacheReasonLabel(reason = '', kind = 'bypass') {
  const labels = kind === 'semanticSkip' ? SEMANTIC_SKIP_REASON_LABELS : BYPASS_REASON_LABELS
  return labels[reason] || prettifyFallbackReason(reason)
}

export function formatTokenCacheInputStrategy(name = '') {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
  return INPUT_STRATEGY_LABELS[normalized] || normalized || '未设置'
}

export function formatTokenCacheTtl(ttlSeconds) {
  const ttl = Number(ttlSeconds) || 0
  if (ttl <= 0) return '未设置'

  if (ttl >= 86400) {
    const days = ttl / 86400
    return `${days % 1 === 0 ? days.toFixed(0) : days.toFixed(1)} 天`
  }

  if (ttl >= 3600) {
    const hours = ttl / 3600
    return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)} 小时`
  }

  if (ttl >= 60) {
    return `${Math.ceil(ttl / 60)} 分钟`
  }

  return `${ttl} 秒`
}

export function formatTokenCacheInputCapsLabel(config = {}) {
  const chars = Number(config?.embedMaxInputChars) || 0
  const bytes = Number(config?.embedMaxInputBytes) || 0
  const parts = []

  if (chars > 0) parts.push(`${formatNumber(chars)} 字符`)
  if (bytes > 0) parts.push(`${formatNumber(bytes)} 字节`)

  if (parts.length > 0) {
    return parts.join(' / ')
  }

  if (
    String(config?.embedInputStrategy || '')
      .trim()
      .toLowerCase() === 'chunked_mean'
  ) {
    return '动态推导（模型上限的 90%）'
  }

  return '未设置'
}

export function formatTokenCacheChunkingLabel(config = {}) {
  const maxChunks = Number(config?.embedChunkMaxChunks) || 0
  const overlap = Number(config?.embedChunkOverlapChars) || 0
  if (maxChunks <= 0) {
    return '关闭'
  }

  return `最多 ${formatNumber(maxChunks)} 块，重叠 ${formatNumber(overlap)} 字符`
}

export function formatTokenCacheToolResultLabel(config = {}) {
  if (!config?.toolResultEnabled) {
    return '关闭'
  }

  const ttl = formatTokenCacheTtl(config?.toolResultTtlSeconds)
  const allowlistCount = Number(config?.toolResultAllowedToolsCount) || 0
  return `${ttl} · 限 ${formatNumber(allowlistCount)} 个工具`
}

export function formatTokenCacheBooleanLabel(value) {
  return value ? '开启' : '关闭'
}
