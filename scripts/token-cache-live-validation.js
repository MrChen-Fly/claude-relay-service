#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const CodexToOpenAIConverter = require('../src/services/codexToOpenAI')

const BASE_URL = process.env.TOKEN_CACHE_LIVE_BASE_URL || 'http://127.0.0.1:8150'
const RESPONSES_PATH = process.env.TOKEN_CACHE_LIVE_PATH || '/openai/responses'
const MODEL = process.env.TOKEN_CACHE_LIVE_MODEL || 'gpt-5'
const CODEx_USER_AGENT = 'codex_cli_rs/0.43.0 (Windows 10.0.26100; x86_64) WindowsTerminal'
const PROVIDED_API_KEY = String(process.env.TOKEN_CACHE_LIVE_API_KEY || '').trim()
const WATCH_FIELDS = [
  'requests',
  'eligibleRequests',
  'hits',
  'misses',
  'stores',
  'exactHits',
  'toolResultHits',
  'toolResultStores',
  'providerPromptCacheRequests',
  'providerPromptCacheReadRequests',
  'providerPromptCacheWriteRequests',
  'providerPromptCacheReadTokens',
  'providerPromptCacheWriteTokens',
  'semanticSkips',
  'semanticChunkedRequests',
  'semanticChunkedChunks'
]

const converter = new CodexToOpenAIConverter()

function maskSecret(value = '') {
  if (typeof value !== 'string' || value.length <= 8) {
    return '***'
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

function normalizeBoolean(value) {
  return value === true || value === 'true'
}

function normalizeCount(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeResponsesPath(value) {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return '/openai/responses'
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function arrayToCountMap(items = []) {
  return new Map(
    (Array.isArray(items) ? items : []).map((item) => [
      String(item.reason || ''),
      normalizeCount(item.count)
    ])
  )
}

function diffBreakdown(beforeItems = [], afterItems = []) {
  const beforeMap = arrayToCountMap(beforeItems)
  const afterMap = arrayToCountMap(afterItems)
  const reasons = new Set([...beforeMap.keys(), ...afterMap.keys()])

  return [...reasons]
    .filter(Boolean)
    .map((reason) => ({
      reason,
      delta: (afterMap.get(reason) || 0) - (beforeMap.get(reason) || 0)
    }))
    .filter((item) => item.delta !== 0)
    .sort((left, right) => right.delta - left.delta)
}

function diffCounters(beforeCounters = {}, afterCounters = {}) {
  return WATCH_FIELDS.reduce((accumulator, field) => {
    accumulator[field] =
      normalizeCount(afterCounters[field]) - normalizeCount(beforeCounters[field])
    return accumulator
  }, {})
}

function buildCodexResponsesBody(overrides = {}) {
  return converter.buildRequestFromOpenAI({
    model: MODEL,
    stream: true,
    temperature: 0,
    ...overrides
  })
}

function buildSearchTool(name = 'mcp__workspace__search_files') {
  return {
    type: 'function',
    function: {
      name,
      description: 'Search the workspace for matching files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' }
        },
        required: ['query']
      }
    }
  }
}

function buildToolHistory(runId) {
  const callId = `call_search_${runId}`
  const query = `token cache live validation ${runId}`
  const toolOutput = {
    runId,
    matches: [
      'src/services/tokenCache/requestTextExtractor.js',
      'src/services/tokenCache/toolResultCacheCandidateExtractor.js',
      'docs/tool-caching-research.md'
    ]
  }

  return {
    callId,
    query,
    toolOutput,
    messages: [
      {
        role: 'user',
        content: `Search the repository for token cache details related to ${runId}.`
      },
      {
        role: 'assistant',
        tool_calls: [
          {
            id: callId,
            type: 'function',
            function: {
              name: 'mcp__workspace__search_files',
              arguments: JSON.stringify({ query, limit: 5 })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: callId,
        content: JSON.stringify(toolOutput)
      }
    ],
    tools: [buildSearchTool()]
  }
}

function buildExactToolRequest(runId) {
  const history = buildToolHistory(runId)
  return buildCodexResponsesBody({
    messages: [
      ...history.messages,
      {
        role: 'user',
        content: 'Summarize the results for prompt-cache alignment.'
      }
    ],
    tools: history.tools,
    tool_choice: 'auto',
    prompt_cache_key: `live-tool-exact-${runId}`
  })
}

function buildToolResultRequest(runId) {
  const history = buildToolHistory(runId)
  return buildCodexResponsesBody({
    messages: [
      ...history.messages,
      {
        role: 'user',
        content: 'What matters most in these matches for replay-safe tool caching?'
      }
    ],
    tools: history.tools,
    tool_choice: 'auto',
    prompt_cache_key: `live-tool-result-${runId}`
  })
}

function buildLongPrompt(runId) {
  return Array.from(
    { length: 1800 },
    (_, index) =>
      `Segment ${index} for ${runId} validates oversized semantic embedding fallback without tools.`
  ).join(' ')
}

function buildLongPlainTextRequest(runId) {
  return buildCodexResponsesBody({
    messages: [
      {
        role: 'user',
        content: buildLongPrompt(runId)
      }
    ],
    prompt_cache_key: `live-long-${runId}`
  })
}

async function requestJson(method, url, options = {}) {
  const response = await axios({
    method,
    url,
    timeout: options.timeout || 600000,
    data: options.data,
    headers: options.headers,
    validateStatus: () => true
  })

  if (response.status >= 200 && response.status < 300) {
    return response
  }

  const error = new Error(`Request failed: ${method.toUpperCase()} ${url} -> ${response.status}`)
  error.status = response.status
  error.responseBody = response.data
  throw error
}

async function login() {
  const initJsonPath = path.join(__dirname, '..', 'data', 'init.json')
  const initData = JSON.parse(fs.readFileSync(initJsonPath, 'utf8'))
  const response = await requestJson('post', `${BASE_URL}/web/auth/login`, {
    data: {
      username: initData.adminUsername,
      password: initData.adminPassword
    }
  })

  return response.data?.token
}

async function getTokenCacheStats(adminToken) {
  const response = await requestJson(
    'get',
    `${BASE_URL}/admin/token-cache/stats?windowMinutes=60`,
    {
      headers: {
        Authorization: `Bearer ${adminToken}`
      }
    }
  )

  return response.data?.data || {}
}

async function getOpenAIResponsesAccounts(adminToken) {
  const response = await requestJson('get', `${BASE_URL}/admin/openai-responses-accounts`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  })

  return Array.isArray(response.data?.data) ? response.data.data : []
}

function pickAccount(accounts = []) {
  const activeAccount = accounts.find(
    (account) =>
      normalizeBoolean(account?.isActive) &&
      account?.status !== 'disabled' &&
      account?.status !== 'error'
  )

  return activeAccount || accounts[0] || null
}

async function createApiKey(adminToken, accountId, runId) {
  const response = await requestJson('post', `${BASE_URL}/admin/api-keys`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    },
    data: {
      name: `tmp-token-cache-live-${runId}`,
      description: 'Temporary API key for token-cache live validation',
      openaiAccountId: `responses:${accountId}`,
      permissions: ['openai']
    }
  })

  return response.data?.data || {}
}

async function deleteApiKey(adminToken, keyId) {
  await requestJson('delete', `${BASE_URL}/admin/api-keys/${keyId}`, {
    headers: {
      Authorization: `Bearer ${adminToken}`
    }
  })
}

async function callResponses(apiKey, body) {
  const response = await axios({
    method: 'post',
    url: `${BASE_URL}${normalizeResponsesPath(RESPONSES_PATH)}`,
    timeout: 600000,
    data: body,
    responseType: 'text',
    validateStatus: () => true,
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'User-Agent': CODEx_USER_AGENT,
      'x-api-key': apiKey
    }
  })

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(
      `Request failed: POST ${BASE_URL}${normalizeResponsesPath(RESPONSES_PATH)} -> ${response.status}`
    )
    error.status = response.status
    error.responseBody = response.data
    throw error
  }

  const streamSummary = summarizeSseResponse(response.data)

  return {
    status: response.status,
    tokenCache: response.headers['x-token-cache'] || '',
    tokenCacheLayer: response.headers['x-token-cache-layer'] || '',
    toolResult: response.headers['x-token-cache-tool-result'] || '',
    responseId: streamSummary.responseId,
    outputPreview: streamSummary.outputPreview
  }
}

function parseSseEvents(raw = '') {
  return String(raw || '')
    .split('\n\n')
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
    )
    .filter(Boolean)
    .map((payload) => {
      try {
        return JSON.parse(payload)
      } catch (_) {
        return null
      }
    })
    .filter(Boolean)
}

function collectOutputTextFromResponse(response = {}) {
  const outputItems = Array.isArray(response.output) ? response.output : []
  return outputItems
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content?.text || content?.output_text || '')
    .filter(Boolean)
    .join(' ')
}

function summarizeSseResponse(raw = '') {
  const events = parseSseEvents(raw)
  const completedEvent = [...events]
    .reverse()
    .find((event) => event?.type === 'response.completed' && event.response)
  const createdEvent = events.find((event) => event?.type === 'response.created' && event.response)

  if (completedEvent?.response) {
    return {
      responseId: completedEvent.response.id || '',
      outputPreview: collectOutputTextFromResponse(completedEvent.response)
    }
  }

  return {
    responseId: createdEvent?.response?.id || '',
    outputPreview: ''
  }
}

async function main() {
  const runId = `live-${Date.now()}`
  let adminToken = ''
  let createdApiKey = null
  let runtimeApiKey = PROVIDED_API_KEY
  const apiKeySource = PROVIDED_API_KEY ? 'provided' : 'temporary_admin_key'

  try {
    adminToken = await login()
    const beforeStats = await getTokenCacheStats(adminToken)

    if (!beforeStats.metrics?.config?.enabled) {
      throw new Error('token cache is disabled in runtime config')
    }

    if (!beforeStats.metrics?.config?.toolResultEnabled) {
      throw new Error('tool-result cache is disabled in runtime config')
    }

    const accounts = await getOpenAIResponsesAccounts(adminToken)
    const account = pickAccount(accounts)
    if (!account?.id) {
      throw new Error('no usable openai-responses account found')
    }

    if (!runtimeApiKey) {
      createdApiKey = await createApiKey(adminToken, account.id, runId)
      if (!createdApiKey?.id || !createdApiKey?.apiKey) {
        throw new Error('admin api-key creation did not return a usable key')
      }
      runtimeApiKey = createdApiKey.apiKey
    }

    const exactToolBody = buildExactToolRequest(runId)
    const toolResultBody = buildToolResultRequest(runId)
    const longPlainTextBody = buildLongPlainTextRequest(runId)

    const observations = []
    observations.push({
      label: 'tool_exact_first',
      ...(await callResponses(runtimeApiKey, exactToolBody))
    })
    observations.push({
      label: 'tool_exact_second',
      ...(await callResponses(runtimeApiKey, exactToolBody))
    })
    observations.push({
      label: 'tool_result_first',
      ...(await callResponses(runtimeApiKey, toolResultBody))
    })
    observations.push({
      label: 'tool_result_second',
      ...(await callResponses(runtimeApiKey, toolResultBody))
    })
    observations.push({
      label: 'long_plain_text',
      ...(await callResponses(runtimeApiKey, longPlainTextBody))
    })

    const afterStats = await getTokenCacheStats(adminToken)
    const metricsDelta = diffCounters(beforeStats.metrics?.total, afterStats.metrics?.total)
    const semanticSkipReasonDelta = diffBreakdown(
      beforeStats.metrics?.semanticSkipReasons?.total,
      afterStats.metrics?.semanticSkipReasons?.total
    )
    const bypassReasonDelta = diffBreakdown(
      beforeStats.metrics?.bypassReasons?.total,
      afterStats.metrics?.bypassReasons?.total
    )

    const summary = {
      baseUrl: BASE_URL,
      requestPath: normalizeResponsesPath(RESPONSES_PATH),
      model: MODEL,
      runId,
      account: {
        id: account.id,
        name: account.name || '',
        providerEndpoint: account.providerEndpoint || ''
      },
      apiKey: {
        id: createdApiKey?.id || '',
        masked: maskSecret(runtimeApiKey),
        source: apiKeySource
      },
      runtimeConfig: {
        enabled: normalizeBoolean(afterStats.metrics?.config?.enabled),
        semanticEnabled: normalizeBoolean(afterStats.metrics?.config?.semanticEnabled),
        embedInputStrategy: afterStats.metrics?.config?.embedInputStrategy || '',
        toolResultEnabled: normalizeBoolean(afterStats.metrics?.config?.toolResultEnabled),
        toolResultAllowedToolsCount: normalizeCount(
          afterStats.metrics?.config?.toolResultAllowedToolsCount
        )
      },
      observations,
      metricsDelta,
      bypassReasonDelta,
      semanticSkipReasonDelta,
      storageAfter: afterStats.storage || {}
    }

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  } finally {
    if (adminToken && createdApiKey?.id) {
      try {
        await deleteApiKey(adminToken, createdApiKey.id)
      } catch (error) {
        process.stderr.write(
          `cleanup_failed: ${createdApiKey.id} ${error.status || ''} ${JSON.stringify(error.responseBody || {})}\n`
        )
      }
    }
  }
}

main().catch((error) => {
  const details = {
    message: error.message,
    status: error.status || null,
    responseBody: error.responseBody || null
  }

  process.stderr.write(`${JSON.stringify(details, null, 2)}\n`)
  process.exit(1)
})
