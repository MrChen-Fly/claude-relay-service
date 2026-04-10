function roundNumber(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0
  }
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function toFloat(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function createUnavailableMetric(message, extra = {}) {
  return {
    available: false,
    message,
    ...extra
  }
}

function parseRedisInfo(raw = '') {
  return raw.split('\n').reduce((result, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return result
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      return result
    }

    const key = trimmed.slice(0, separatorIndex)
    const value = trimmed.slice(separatorIndex + 1)
    result[key] = value
    return result
  }, {})
}

module.exports = {
  roundNumber,
  toInt,
  toFloat,
  createUnavailableMetric,
  parseRedisInfo
}
