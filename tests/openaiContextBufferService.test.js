jest.mock('../src/models/redis', () => ({
  getOpenAIL2ContextBuffer: jest.fn(),
  appendOpenAIL2ContextBuffer: jest.fn(),
  incrementOpenAIL2CacheMetric: jest.fn()
}))

const config = require('../config/config')
const redis = require('../src/models/redis')
const contextBufferService = require('../src/services/cache/gptcache/contextBufferService')

describe('contextBufferService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    config.openaiCache = {
      ...(config.openaiCache || {}),
      l2: {
        ...(config.openaiCache?.l2 || {}),
        contextBuffer: {
          enabled: true,
          ttlSeconds: 604800,
          maxItems: 6
        }
      }
    }
  })

  it('loads a per-session buffer snapshot when session_id is present', async () => {
    redis.getOpenAIL2ContextBuffer.mockResolvedValue([
      {
        requestText: 'user: hello',
        responseText: 'assistant: hi',
        requestHash: 'req-1'
      }
    ])

    const snapshot = await contextBufferService.getSnapshot({
      tenantId: 'api-key-1',
      requestHeaders: {
        session_id: 'session-1'
      },
      requestBody: {}
    })

    expect(snapshot.enabled).toBe(true)
    expect(snapshot.scopeType).toBe('session')
    expect(snapshot.bufferKey).toContain('cache:openai:l2:ctx:v1:api-key-1:')
    expect(snapshot.items).toHaveLength(1)
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('context_buffer_hit')
  })

  it('skips buffer reads when no session or conversation scope exists', async () => {
    const snapshot = await contextBufferService.getSnapshot({
      tenantId: 'api-key-1',
      requestHeaders: {},
      requestBody: {}
    })

    expect(snapshot.enabled).toBe(false)
    expect(snapshot.reason).toBe('missing_context_scope')
    expect(redis.getOpenAIL2ContextBuffer).not.toHaveBeenCalled()
  })

  it('persists a normalized interaction back into the context buffer', async () => {
    const result = await contextBufferService.rememberInteraction(
      {
        enabled: true,
        bufferKey: 'cache:openai:l2:ctx:v1:api-key-1:hash-1',
        ttlSeconds: 604800,
        maxItems: 6
      },
      {
        requestText: ' user: hello ',
        responseText: ' assistant: hi ',
        model: 'gpt-5',
        cacheSource: 'l2'
      }
    )

    expect(result.stored).toBe(true)
    expect(redis.appendOpenAIL2ContextBuffer).toHaveBeenCalledWith(
      'cache:openai:l2:ctx:v1:api-key-1:hash-1',
      expect.objectContaining({
        requestText: 'user: hello',
        responseText: 'assistant: hi',
        model: 'gpt-5',
        cacheSource: 'l2',
        requestHash: expect.any(String)
      }),
      604800,
      6
    )
    expect(redis.incrementOpenAIL2CacheMetric).toHaveBeenCalledWith('context_buffer_write')
  })
})
