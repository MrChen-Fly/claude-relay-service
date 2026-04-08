const ResponsesToChatConverter = require('./responsesToChatConverter')
const CodexToOpenAIConverter = require('../codexToOpenAI')

function isV1Path(path = '') {
  return path.startsWith('/v1/')
}

function getResponsesPath(path = '') {
  return isV1Path(path) ? '/v1/responses' : '/responses'
}

function getChatCompletionsPath(path = '') {
  return isV1Path(path) ? '/v1/chat/completions' : '/chat/completions'
}

function dedupeAttempts(attempts = []) {
  const seen = new Set()
  return attempts.filter((attempt) => {
    const key = `${attempt.path}:${attempt.transform}:${attempt.body?.stream !== false}`
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function selectAttemptOrder(
  providerEndpoint,
  clientPreferredProtocol,
  preferredAttempt,
  fallbackAttempt
) {
  const preferredProtocol =
    providerEndpoint === 'responses'
      ? 'responses'
      : providerEndpoint === 'completions'
        ? 'chat_completions'
        : clientPreferredProtocol

  const attempts =
    preferredProtocol === clientPreferredProtocol
      ? [preferredAttempt, fallbackAttempt]
      : [fallbackAttempt, preferredAttempt]

  return dedupeAttempts(attempts)
}

function buildResponsesClientAttempts({
  path = '/v1/responses',
  body = {},
  requestedModel = null,
  providerEndpoint = 'responses'
} = {}) {
  const responseModel = requestedModel || body?.model || null
  const requestConverter = new ResponsesToChatConverter()

  const responsesAttempt = {
    path: getResponsesPath(path),
    body,
    transform: 'passthrough',
    requestedModel: responseModel
  }
  const chatAttempt = {
    path: getChatCompletionsPath(path),
    body: requestConverter.buildRequestFromResponses(body),
    transform: 'chat_to_responses',
    requestedModel: responseModel
  }

  return selectAttemptOrder(providerEndpoint, 'responses', responsesAttempt, chatAttempt)
}

function buildChatClientAttempts({
  path = '/v1/chat/completions',
  body = {},
  requestedModel = null,
  providerEndpoint = 'responses',
  codexInstructions = ''
} = {}) {
  const converter = new CodexToOpenAIConverter()
  const responsesBody = converter.buildRequestFromOpenAI(body)
  if (codexInstructions) {
    responsesBody.instructions = codexInstructions
  }

  const chatAttempt = {
    path: getChatCompletionsPath(path),
    body,
    transform: 'passthrough',
    requestedModel
  }
  const responsesAttempt = {
    path: getResponsesPath(path),
    body: responsesBody,
    transform: 'responses_to_chat',
    requestedModel
  }

  return selectAttemptOrder(providerEndpoint, 'chat_completions', chatAttempt, responsesAttempt)
}

function normalizeTargetPath(baseApi = '', targetPath = '') {
  if (String(baseApi).endsWith('/v1') && String(targetPath).startsWith('/v1/')) {
    return targetPath.slice(3)
  }

  return targetPath
}

function shouldRetryWithAlternateProtocol(response, hasAlternateAttempt) {
  if (!hasAlternateAttempt) {
    return false
  }

  if ([404, 405, 415, 501].includes(response.status)) {
    return true
  }

  if (![400, 403, 422].includes(response.status)) {
    return false
  }

  const errorData = response.data?.error || response.data || {}
  const haystack = `${errorData.code || ''} ${errorData.type || ''} ${errorData.message || ''}`
    .toLowerCase()
    .trim()

  if (!haystack) {
    return false
  }

  const retryPatterns = [
    /unsupported.*endpoint/,
    /unknown.*endpoint/,
    /unknown.*path/,
    /unknown.*url/,
    /no route/,
    /not found/,
    /illegal access/,
    /method not allowed/,
    /missing required parameter.*\b(messages|input)\b/,
    /\b(messages|input)\b.*\brequired\b/,
    /chat\/completions/,
    /\/responses\b/
  ]

  return retryPatterns.some((pattern) => pattern.test(haystack))
}

module.exports = {
  buildChatClientAttempts,
  buildResponsesClientAttempts,
  normalizeTargetPath,
  shouldRetryWithAlternateProtocol
}
