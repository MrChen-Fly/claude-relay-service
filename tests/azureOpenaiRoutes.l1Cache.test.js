const express = require('express')
const request = require('supertest')

jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))
jest.mock('../src/middleware/auth', () => ({
  authenticateApiKey: (req, _res, next) => {
    req.apiKey = {
      id: 'api-key-1',
      permissions: ['openai']
    }
    next()
  }
}))
jest.mock('../src/services/account/azureOpenaiAccountService', () => ({
  getAccount: jest.fn(),
  selectAvailableAccount: jest.fn(),
  updateAccountUsage: jest.fn()
}))
jest.mock('../src/services/relay/azureOpenaiRelayService', () => ({
  handleAzureOpenAIRequest: jest.fn(),
  handleStreamResponse: jest.fn(),
  handleNonStreamResponse: jest.fn()
}))
jest.mock('../src/services/apiKeyService', () => ({
  recordUsage: jest.fn(),
  getUsageStats: jest.fn()
}))
jest.mock('../src/utils/upstreamErrorHelper', () => ({
  isTempUnavailable: jest.fn().mockResolvedValue(false),
  markTempUnavailable: jest.fn(),
  parseRetryAfter: jest.fn()
}))
jest.mock('../src/services/cache/openaiL1CacheService', () => ({
  beginRequest: jest.fn(),
  storeResponse: jest.fn(),
  finalizeRequest: jest.fn(),
  replayCachedResponse: jest.fn()
}))

const azureOpenaiAccountService = require('../src/services/account/azureOpenaiAccountService')
const azureOpenaiRelayService = require('../src/services/relay/azureOpenaiRelayService')
const apiKeyService = require('../src/services/apiKeyService')
const openaiL1CacheService = require('../src/services/cache/openaiL1CacheService')
const router = require('../src/routes/azureOpenaiRoutes')

describe('azureOpenaiRoutes L1 cache integration', () => {
  let app

  beforeEach(() => {
    jest.clearAllMocks()
    app = express()
    app.use(express.json())
    app.use(router)

    azureOpenaiAccountService.selectAvailableAccount.mockResolvedValue({
      id: 'azure-account-1',
      isActive: 'true'
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([
    ['/chat/completions', 'chat/completions'],
    ['/responses', 'responses'],
    ['/embeddings', 'embeddings']
  ])('replays cached %s responses without touching upstream usage', async (path, endpoint) => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'hit',
      entry: {
        statusCode: 200,
        body: {
          endpoint
        },
        headers: {
          'x-request-id': `cached-${endpoint}`
        }
      }
    })
    openaiL1CacheService.replayCachedResponse.mockImplementation((res, entry) =>
      res.status(entry.statusCode).json(entry.body)
    )

    const response = await request(app)
      .post(path)
      .send({
        model: endpoint === 'embeddings' ? 'text-embedding-3-small' : 'gpt-4o-mini',
        input: endpoint === 'embeddings' ? 'hello' : undefined,
        messages:
          endpoint === 'chat/completions' ? [{ role: 'user', content: 'hello' }] : undefined,
        stream: false
      })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ endpoint })
    expect(azureOpenaiRelayService.handleAzureOpenAIRequest).not.toHaveBeenCalled()
    expect(apiKeyService.recordUsage).not.toHaveBeenCalled()
  })

  it('stores non-stream Azure responses after a cache miss', async () => {
    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'cache-key-azure',
      ttlSeconds: 86400,
      lockAcquired: true
    })
    azureOpenaiRelayService.handleAzureOpenAIRequest.mockResolvedValue({
      status: 200,
      headers: {
        'x-request-id': 'azure-upstream-1'
      },
      data: {
        id: 'resp_1'
      }
    })
    azureOpenaiRelayService.handleNonStreamResponse.mockReturnValue({
      responseData: {
        id: 'resp_1'
      },
      usageData: {
        input_tokens: 11,
        output_tokens: 7
      },
      actualModel: 'gpt-4o-mini'
    })
    azureOpenaiRelayService.handleNonStreamResponse.mockImplementation((upstreamResponse, res) => {
      res.status(upstreamResponse.status).json(upstreamResponse.data)
      return {
        responseData: {
          id: 'resp_1'
        },
        usageData: {
          input_tokens: 11,
          output_tokens: 7
        },
        actualModel: 'gpt-4o-mini'
      }
    })

    const response = await request(app).post('/responses').send({
      model: 'gpt-4o-mini',
      input: 'hello',
      stream: false
    })

    expect(response.status).toBe(200)
    expect(openaiL1CacheService.storeResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'miss',
        cacheKey: 'cache-key-azure'
      }),
      expect.objectContaining({
        statusCode: 200,
        body: {
          id: 'resp_1'
        },
        headers: {
          'x-request-id': 'azure-upstream-1'
        },
        actualModel: 'gpt-4o-mini'
      })
    )
  })

  it('unrefs the usage cleanup timer after reporting usage', async () => {
    const timer = {
      unref: jest.fn()
    }
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(() => timer)

    openaiL1CacheService.beginRequest.mockResolvedValue({
      kind: 'miss',
      cacheKey: 'cache-key-azure',
      ttlSeconds: 86400,
      lockAcquired: true
    })
    azureOpenaiRelayService.handleAzureOpenAIRequest.mockResolvedValue({
      status: 200,
      headers: {
        'x-request-id': 'azure-upstream-2'
      },
      data: {
        id: 'resp_2'
      }
    })
    azureOpenaiRelayService.handleNonStreamResponse.mockImplementation((upstreamResponse, res) => {
      res.status(upstreamResponse.status).json(upstreamResponse.data)
      return {
        responseData: {
          id: 'resp_2'
        },
        usageData: {
          input_tokens: 3,
          output_tokens: 2
        },
        actualModel: 'gpt-4o-mini'
      }
    })

    const response = await request(app).post('/responses').send({
      model: 'gpt-4o-mini',
      input: 'hello',
      stream: false
    })

    expect(response.status).toBe(200)
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 1000)
    expect(timer.unref).toHaveBeenCalledTimes(1)
  })
})
