const fs = require('fs')
const path = require('path')
const config = require('../../config/config')

const DEFAULT_LINE_LIMIT = 120
const MAX_LINE_LIMIT = 500
const MAX_SUMMARY_ITEMS = 5
const LEVELS = ['all', 'error', 'warn', 'info', 'debug']
const LOG_FILE_RULES = [
  { pattern: /^claude-relay-\d{4}-\d{2}-\d{2}\.log$/, kind: 'application' },
  { pattern: /^claude-relay-error-\d{4}-\d{2}-\d{2}\.log$/, kind: 'error' },
  { pattern: /^claude-relay-security-\d{4}-\d{2}-\d{2}\.log$/, kind: 'security' },
  { pattern: /^service\.log$/, kind: 'application' },
  { pattern: /^service-error\.log$/, kind: 'error' },
  { pattern: /^exceptions\.log$/, kind: 'exceptions' },
  { pattern: /^rejections\.log$/, kind: 'rejections' }
]

function getLogsDirectory() {
  return config.logging?.dirname || path.join(__dirname, '../../logs')
}

function resolveLogKind(fileName) {
  return LOG_FILE_RULES.find((rule) => rule.pattern.test(fileName))?.kind || 'other'
}

function isSupportedLogFile(fileName) {
  return LOG_FILE_RULES.some((rule) => rule.pattern.test(fileName))
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LINE_LIMIT
  }
  return Math.min(Math.max(parsed, 20), MAX_LINE_LIMIT)
}

function normalizeLevel(level) {
  const normalized = String(level || '').toLowerCase()
  if (!normalized || !LEVELS.includes(normalized)) {
    return 'all'
  }
  return normalized
}

function inferTextLevel(rawLine) {
  const value = rawLine.toLowerCase()
  if (value.includes('error') || value.includes('failed') || value.includes('exception')) {
    return 'error'
  }
  if (value.includes('warn')) {
    return 'warn'
  }
  if (value.includes('debug')) {
    return 'debug'
  }
  return 'info'
}

function parseJsonLine(rawLine) {
  try {
    const parsed = JSON.parse(rawLine)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeLogEntry(rawLine, lineNumber, fileName) {
  const parsed = parseJsonLine(rawLine)
  if (parsed) {
    const { ts, lvl, msg, ...metadata } = parsed
    const normalizedLevel = normalizeLevel(lvl)
    return {
      id: `${fileName}:${lineNumber}`,
      fileName,
      lineNumber,
      timestamp: ts || null,
      level: normalizedLevel === 'all' ? inferTextLevel(rawLine) : normalizedLevel,
      message: msg || rawLine,
      metadata,
      raw: rawLine
    }
  }

  return {
    id: `${fileName}:${lineNumber}`,
    fileName,
    lineNumber,
    timestamp: null,
    level: inferTextLevel(rawLine),
    message: rawLine,
    metadata: {},
    raw: rawLine
  }
}

function matchesFilters(entry, level, searchTerm) {
  if (level !== 'all' && entry.level !== level) {
    return false
  }

  if (!searchTerm) {
    return true
  }

  const haystack =
    `${entry.message}\n${entry.raw}\n${JSON.stringify(entry.metadata || {})}`.toLowerCase()
  return haystack.includes(searchTerm)
}

function createEmptySummary() {
  return {
    sampleSize: 0,
    levelCounts: {
      error: 0,
      warn: 0,
      info: 0,
      debug: 0
    },
    topMessages: [],
    topTypes: []
  }
}

function normalizeSummaryMessage(message) {
  const normalized = String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, 160) || '空消息'
}

function buildSummary(entries) {
  const summary = createEmptySummary()
  const messageBuckets = new Map()
  const typeBuckets = new Map()

  summary.sampleSize = entries.length

  for (const entry of entries) {
    if (summary.levelCounts[entry.level] !== undefined) {
      summary.levelCounts[entry.level] += 1
    }

    const entryType = entry.metadata?.type ? String(entry.metadata.type) : ''
    if (entryType) {
      const currentType = typeBuckets.get(entryType) || { type: entryType, count: 0 }
      currentType.count += 1
      typeBuckets.set(entryType, currentType)
    }

    if (entry.level === 'error' || entry.level === 'warn') {
      const message = normalizeSummaryMessage(entry.message)
      const messageKey = `${entry.level}:${message}`
      const currentMessage = messageBuckets.get(messageKey) || {
        level: entry.level,
        message,
        count: 0
      }
      currentMessage.count += 1
      messageBuckets.set(messageKey, currentMessage)
    }
  }

  summary.topMessages = Array.from(messageBuckets.values())
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
    .slice(0, MAX_SUMMARY_ITEMS)

  summary.topTypes = Array.from(typeBuckets.values())
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
    .slice(0, MAX_SUMMARY_ITEMS)

  return summary
}

async function listLogFiles() {
  const directory = getLogsDirectory()

  try {
    await fs.promises.mkdir(directory, { recursive: true })
    const dirEntries = await fs.promises.readdir(directory, { withFileTypes: true })

    const files = await Promise.all(
      dirEntries
        .filter((entry) => entry.isFile() && isSupportedLogFile(entry.name))
        .map(async (entry) => {
          const fullPath = path.join(directory, entry.name)
          const stats = await fs.promises.stat(fullPath)
          return {
            name: entry.name,
            kind: resolveLogKind(entry.name),
            size: stats.size,
            updatedAt: stats.mtime.toISOString()
          }
        })
    )

    return files.sort((left, right) => {
      const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      if (timeDiff !== 0) {
        return timeDiff
      }

      const leftRank = left.kind === 'application' ? 0 : 1
      const rightRank = right.kind === 'application' ? 0 : 1
      if (leftRank !== rightRank) {
        return leftRank - rightRank
      }

      return right.name.localeCompare(left.name)
    })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function resolveSelectedFile(files, requestedFile) {
  if (requestedFile && isSupportedLogFile(requestedFile)) {
    const matched = files.find((file) => file.name === requestedFile)
    if (matched) {
      return matched.name
    }
  }

  return files.find((file) => file.kind === 'application')?.name || files[0]?.name || null
}

async function getSystemLogFile(requestedFile, options = {}) {
  const files = await listLogFiles()
  const allowFallback = options.allowFallback !== false
  const selectedFile = allowFallback
    ? resolveSelectedFile(files, requestedFile)
    : files.find((file) => file.name === requestedFile)?.name || null

  if (!selectedFile) {
    return null
  }

  return {
    name: selectedFile,
    path: path.join(getLogsDirectory(), selectedFile),
    meta: files.find((file) => file.name === selectedFile) || null
  }
}

async function getSystemLogs(options = {}) {
  const files = await listLogFiles()
  const selectedFile = resolveSelectedFile(files, options.file)
  const limit = normalizeLimit(options.limit)
  const level = normalizeLevel(options.level)
  const search = String(options.search || '')
    .trim()
    .toLowerCase()

  if (!selectedFile) {
    return {
      files: [],
      selectedFile: null,
      selectedFileMeta: null,
      entries: [],
      totalEntries: 0,
      filteredEntries: 0,
      hasMore: false,
      summary: createEmptySummary(),
      filters: { limit, level, search },
      availableLevels: LEVELS
    }
  }

  const logPath = path.join(getLogsDirectory(), selectedFile)
  const rawContent = await fs.promises.readFile(logPath, 'utf8')
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const normalizedEntries = lines
    .map((line, index) => normalizeLogEntry(line, index + 1, selectedFile))
    .reverse()

  const filteredEntries = normalizedEntries.filter((entry) => matchesFilters(entry, level, search))
  const entries = filteredEntries.slice(0, limit)
  const summary = buildSummary(filteredEntries)

  return {
    files,
    selectedFile,
    selectedFileMeta: files.find((file) => file.name === selectedFile) || null,
    entries,
    totalEntries: normalizedEntries.length,
    filteredEntries: filteredEntries.length,
    hasMore: filteredEntries.length > entries.length,
    summary,
    filters: { limit, level, search },
    availableLevels: LEVELS
  }
}

module.exports = {
  getSystemLogs,
  listLogFiles,
  getSystemLogFile
}
