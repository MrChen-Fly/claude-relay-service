const { Readable } = require('stream')

jest.mock('axios', () => jest.fn())
jest.mock('../src/services/account/openaiResponsesAccountService', () => ({
  getAccount: jest.fn(),
  updateAccount: jest.fn(),
  normalizeProviderEndpoint: jest.fn((providerEndpoint) => providerEndpoint || 'responses'),
  getMappedModel: jest.fn((modelMapping, requestedModel) => {
    if (!modelMapping || !requestedModel) {
      return requestedModel
    }

    return modelMapping[requestedModel] || requestedModel
  })
}))
jest.mock('../src/services/openaiProtocol/capabilityProfile', () => ({
  inferAccountCapabilities: jest.fn(() => ({
    providerEndpoint: 'responses',
    supportsStreaming: true,
    supportsTools: true,
    supportsReasoning: true,
    supportsJsonSchema: true
  }))
}))
jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn()
}))
jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn()
}))

const axios = require('axios')
const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')
const openaiResponsesUpstreamProbeService = require('../src/services/openaiProtocol/openaiResponsesUpstreamProbeService')

function createSSEStream(events = []) {
  return Readable.from(events)
}

describe('openaiResponsesUpstreamProbeService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('falls back to chat/completions and persists detected capabilities', async () => {
    const account = {
      id: 'responses-1',
      name: 'Probe Account',
      baseApi: 'https://relay.example.com',
      apiKey: 'secret-key',
      providerEndpoint: 'responses',
      modelMapping: {}
    }

    axios
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: {
                content: 'OK'
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        data: createSSEStream([
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: {
                content: 'tool-ok'
              }
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 400,
        statusText: 'Bad Request',
        data: {
          error: {
            message: 'reasoning is not supported'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 404,
        statusText: 'Not Found',
        data: {
          error: {
            message: 'unknown endpoint /v1/responses'
          }
        }
      })
      .mockResolvedValueOnce({
        status: 400,
        statusText: 'Bad Request',
        data: {
          error: {
            message: 'json_schema is not supported'
          }
        }
      })

    const result = await openaiResponsesUpstreamProbeService.probeAccount(account, {
      model: 'mimo-v2-pro'
    })

    expect(result).toEqual({
      accountId: 'responses-1',
      accountName: 'Probe Account',
      model: 'mimo-v2-pro',
      resolvedModel: 'mimo-v2-pro',
      latency: expect.any(Number),
      responseText: 'OK',
      selectedUpstreamPath: '/v1/chat/completions',
      fallbackUsed: true,
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsReasoning: false,
        supportsJsonSchema: false
      }
    })
    expect(openaiResponsesAccountService.updateAccount).toHaveBeenCalledWith('responses-1', {
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoning: false,
      supportsJsonSchema: false
    })
    expect(axios).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://relay.example.com/v1/responses',
        responseType: 'json'
      })
    )
    expect(axios).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'https://relay.example.com/v1/chat/completions',
        responseType: 'json'
      })
    )
    expect(axios).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: 'https://relay.example.com/v1/chat/completions',
        responseType: 'stream'
      })
    )
  })
})
