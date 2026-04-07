const ResponsesToChatConverter = require('./responsesToChatConverter')
const CodexToOpenAIConverter = require('../codexToOpenAI')
const openaiResponsesRelayService = require('../relay/openaiResponsesRelayService')

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

class OpenAIProtocolBridgeService {
  _selectAttemptOrder(
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

  async handleChatClientRequest(
    req,
    res,
    account,
    apiKeyData,
    { requestedModel = null, providerEndpoint = 'responses', codexInstructions = '' } = {}
  ) {
    req._serviceTier = req.body?.service_tier || null

    const converter = new CodexToOpenAIConverter()
    const responsesBody = converter.buildRequestFromOpenAI(req.body)
    if (codexInstructions) {
      responsesBody.instructions = codexInstructions
    }

    const chatAttempt = {
      path: getChatCompletionsPath(req.path),
      body: req.body,
      transform: 'passthrough',
      requestedModel
    }
    const responsesAttempt = {
      path: getResponsesPath(req.path),
      body: responsesBody,
      transform: 'responses_to_chat',
      requestedModel
    }

    return openaiResponsesRelayService.handleRequest(req, res, account, apiKeyData, {
      attempts: this._selectAttemptOrder(
        providerEndpoint,
        'chat_completions',
        chatAttempt,
        responsesAttempt
      )
    })
  }

  async handleResponsesClientRequest(
    req,
    res,
    account,
    apiKeyData,
    requestedModel = null,
    { providerEndpoint = 'responses' } = {}
  ) {
    const responseModel = requestedModel || req.body?.model || null
    const requestConverter = new ResponsesToChatConverter()

    const responsesAttempt = {
      path: getResponsesPath(req.path),
      body: req.body,
      transform: 'passthrough',
      requestedModel: responseModel
    }
    const chatAttempt = {
      path: getChatCompletionsPath(req.path),
      body: requestConverter.buildRequestFromResponses(req.body),
      transform: 'chat_to_responses',
      requestedModel: responseModel
    }

    return openaiResponsesRelayService.handleRequest(req, res, account, apiKeyData, {
      attempts: this._selectAttemptOrder(
        providerEndpoint,
        'responses',
        responsesAttempt,
        chatAttempt
      )
    })
  }
}

module.exports = new OpenAIProtocolBridgeService()
