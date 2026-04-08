const openaiResponsesRelayService = require('../relay/openaiResponsesRelayService')
const {
  buildChatClientAttempts,
  buildResponsesClientAttempts
} = require('./upstreamProtocolHelper')

class OpenAIProtocolBridgeService {
  async handleChatClientRequest(
    req,
    res,
    account,
    apiKeyData,
    { requestedModel = null, providerEndpoint = 'responses', codexInstructions = '' } = {}
  ) {
    req._serviceTier = req.body?.service_tier || null

    return openaiResponsesRelayService.handleRequest(req, res, account, apiKeyData, {
      attempts: buildChatClientAttempts({
        path: req.path,
        body: req.body,
        requestedModel,
        providerEndpoint,
        codexInstructions
      })
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
    return openaiResponsesRelayService.handleRequest(req, res, account, apiKeyData, {
      attempts: buildResponsesClientAttempts({
        path: req.path,
        body: req.body,
        requestedModel,
        providerEndpoint
      })
    })
  }
}

module.exports = new OpenAIProtocolBridgeService()
