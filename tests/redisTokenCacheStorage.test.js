jest.mock('../src/models/redis', () => ({
  setex: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  scanKeys: jest.fn(),
  batchDelChunked: jest.fn()
}))

const redis = require('../src/models/redis')
const RedisTokenCacheStorage = require('../src/services/tokenCache/redisTokenCacheStorage')

describe('RedisTokenCacheStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    redis.scanKeys.mockResolvedValue([])
    redis.batchDelChunked.mockResolvedValue(0)
    redis.del.mockResolvedValue(2)
  })

  it('deletes scoped semantic embeddings together with entry and prompt', async () => {
    redis.scanKeys.mockResolvedValue([
      'token_cache:test:embedding:scope-a:cache-key-1',
      'token_cache:test:embedding:scope-b:cache-key-1'
    ])

    const storage = new RedisTokenCacheStorage({
      namespace: 'token_cache:test'
    })

    await storage.delete('cache-key-1')

    expect(redis.del).toHaveBeenCalledWith(
      'token_cache:test:entry:cache-key-1',
      'token_cache:test:prompt:cache-key-1'
    )
    expect(redis.scanKeys).toHaveBeenCalledWith('token_cache:test:embedding:*:cache-key-1')
    expect(redis.batchDelChunked).toHaveBeenCalledWith([
      'token_cache:test:embedding:scope-a:cache-key-1',
      'token_cache:test:embedding:scope-b:cache-key-1'
    ])
  })
})
