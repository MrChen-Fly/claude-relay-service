jest.mock('axios', () => ({
  get: jest.fn()
}))

const axios = require('axios')
const {
  EmbeddingModelInfoResolver,
  resolveKnownEmbeddingModelTokenLimit,
  estimateMaxInputCharsFromTokenLimit
} = require('../src/services/tokenCache/embeddingModelInfoResolver')

describe('embeddingModelInfoResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps known SiliconFlow embedding models to token limits', () => {
    expect(resolveKnownEmbeddingModelTokenLimit('Qwen/Qwen3-Embedding-8B')).toBe(32768)
    expect(resolveKnownEmbeddingModelTokenLimit('Qwen/Qwen3-Embedding-4B')).toBe(32768)
    expect(resolveKnownEmbeddingModelTokenLimit('BAAI/bge-m3')).toBe(8192)
    expect(resolveKnownEmbeddingModelTokenLimit('Pro/BAAI/bge-m3')).toBe(8192)
    expect(resolveKnownEmbeddingModelTokenLimit('unknown-model')).toBe(0)
  })

  it('derives a conservative char cap from token limits', () => {
    expect(estimateMaxInputCharsFromTokenLimit(32768)).toBe(103218)
    expect(estimateMaxInputCharsFromTokenLimit(8192)).toBe(25802)
    expect(estimateMaxInputCharsFromTokenLimit(0)).toBe(0)
  })

  it('fetches model info from /models and resolves a recommended char cap', async () => {
    axios.get.mockResolvedValue({
      data: {
        data: [{ id: 'Qwen/Qwen3-Embedding-8B' }]
      }
    })

    const resolver = new EmbeddingModelInfoResolver({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      timeout: 30000
    })

    const result = await resolver.resolve('Qwen/Qwen3-Embedding-8B')

    expect(result).toEqual({
      id: 'Qwen/Qwen3-Embedding-8B',
      found: true,
      tokenLimit: 32768,
      recommendedMaxInputChars: 103218,
      source: 'models_api+known_limit_map'
    })
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/models',
      expect.objectContaining({
        timeout: 30000,
        headers: expect.objectContaining({
          Authorization: 'Bearer semantic-key'
        })
      })
    )
  })
})
