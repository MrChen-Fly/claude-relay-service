jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn()
}))

const axios = require('axios')
const OpenAISemanticProvider = require('../src/services/tokenCache/openAISemanticProvider')
const {
  isSemanticInputTooLargeError
} = require('../src/services/tokenCache/semanticProviderErrors')

describe('openAISemanticProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses the configured OpenAI-compatible base URL for embeddings', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post.mockResolvedValue({
      data: {
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      }
    })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      metrics
    })

    const result = await provider.embed('hello world')

    expect(result).toEqual([0.1, 0.2, 0.3])
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'hello world',
        model: 'BAAI/bge-m3'
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer semantic-key'
        })
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      providerCalls: 1
    })
  })

  it('uses the configured OpenAI-compatible base URL for similarity verification', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: 'YES'
            }
          }
        ]
      }
    })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      verifyModel: 'Qwen/Qwen2.5-7B-Instruct',
      metrics
    })

    const result = await provider.checkSimilarity('prompt 1', 'prompt 2')

    expect(result).toBe(true)
    expect(axios.post).toHaveBeenCalledWith(
      'https://api.siliconflow.cn/v1/chat/completions',
      expect.objectContaining({
        model: 'Qwen/Qwen2.5-7B-Instruct'
      }),
      expect.any(Object)
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      providerCalls: 1
    })
  })

  it('records provider errors when the embedding request fails', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post.mockRejectedValue(new Error('boom'))

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      metrics
    })

    await expect(provider.embed('hello world')).rejects.toThrow('boom')
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      providerCalls: 1
    })
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      providerErrors: 1
    })
  })

  it('skips semantic embedding locally when the configured char limit is exceeded', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      maxInputChars: 5,
      metrics
    })

    let error = null
    try {
      await provider.embed('hello world')
    } catch (caughtError) {
      error = caughtError
    }

    expect(isSemanticInputTooLargeError(error)).toBe(true)
    expect(error.reason).toBe('input_too_large_config_chars')
    expect(axios.post).not.toHaveBeenCalled()
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticSkips: 1,
      'semanticSkipReason:input_too_large_config_chars': 1
    })
  })

  it('normalizes provider 413 errors into semantic input-too-large skips', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post.mockRejectedValue({
      message: 'Request failed with status code 413',
      response: {
        status: 413,
        data: {
          code: 20042,
          message: 'input must have less than 8192 tokens'
        }
      }
    })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      metrics
    })

    let error = null
    try {
      await provider.embed('hello world')
    } catch (caughtError) {
      error = caughtError
    }

    expect(isSemanticInputTooLargeError(error)).toBe(true)
    expect(error.reason).toBe('input_too_large_provider')
    expect(error.details).toEqual(
      expect.objectContaining({
        providerStatus: 413,
        providerCode: 20042
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      providerCalls: 1
    })
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticSkips: 1,
      'semanticSkipReason:input_too_large_provider': 1
    })
    expect(metrics.recordAsync).not.toHaveBeenCalledWith({
      providerErrors: 1
    })
  })

  it('uses the chunked_mean strategy to embed oversized plain-text input by chunks', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [1, 1] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [3, 3] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [5, 5] }]
        }
      })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      inputStrategyName: 'chunked_mean',
      maxInputChars: 5,
      chunkMaxChunks: 3,
      chunkOverlapChars: 0,
      metrics
    })

    const result = await provider.embed('abcdefghijklmno')

    expect(result).toEqual([3, 3])
    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'abcde',
        model: 'BAAI/bge-m3'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'fghij',
        model: 'BAAI/bge-m3'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      3,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'klmno',
        model: 'BAAI/bge-m3'
      },
      expect.any(Object)
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticChunkedRequests: 1,
      semanticChunkedChunks: 3
    })
  })

  it('adaptively splits a chunk again when SiliconFlow rejects the first oversized chunk with 400', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    axios.post
      .mockRejectedValueOnce({
        message: 'Request failed with status code 400',
        response: {
          status: 400,
          data: {
            code: 20015,
            message: 'The parameter is invalid. Please check again.'
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [1, 1] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [3, 3] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [5, 5] }]
        }
      })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'Qwen/Qwen3-Embedding-8B',
      inputStrategyName: 'chunked_mean',
      maxInputChars: 10,
      chunkMaxChunks: 4,
      chunkOverlapChars: 0,
      metrics
    })

    const result = await provider.embed('abcdefghijklmnop')

    expect(result).toEqual([3.125, 3.125])
    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'abcdefghij',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'abcde',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      3,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'fghij',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      4,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'klmnop',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticChunkedRequests: 1,
      semanticChunkedChunks: 2
    })
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticChunkedChunks: 1
    })
    expect(metrics.recordAsync).not.toHaveBeenCalledWith({
      providerErrors: 1
    })
  })

  it('uses model-info-derived maxInputChars when chunked_mean has no explicit char limit', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    const modelInfoResolver = {
      resolve: jest.fn().mockResolvedValue({
        id: 'Qwen/Qwen3-Embedding-8B',
        found: true,
        tokenLimit: 32768,
        recommendedMaxInputChars: 10,
        source: 'models_api+known_limit_map'
      })
    }

    axios.post
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [1, 1] }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ embedding: [3, 3] }]
        }
      })

    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'Qwen/Qwen3-Embedding-8B',
      inputStrategyName: 'chunked_mean',
      chunkMaxChunks: 3,
      chunkOverlapChars: 0,
      modelInfoResolver,
      metrics
    })

    const result = await provider.embed('abcdefghijk')

    expect(result).toEqual([13 / 11, 13 / 11])
    expect(modelInfoResolver.resolve).toHaveBeenCalledWith('Qwen/Qwen3-Embedding-8B')
    expect(axios.post).toHaveBeenNthCalledWith(
      1,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'abcdefghij',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(axios.post).toHaveBeenNthCalledWith(
      2,
      'https://api.siliconflow.cn/v1/embeddings',
      {
        input: 'k',
        model: 'Qwen/Qwen3-Embedding-8B'
      },
      expect.any(Object)
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticChunkedRequests: 1,
      semanticChunkedChunks: 2
    })
  })

  it('skips semantic embedding when chunked_mean would exceed the configured chunk limit', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new OpenAISemanticProvider({
      apiKey: 'semantic-key',
      baseUrl: 'https://api.siliconflow.cn/v1',
      embedModel: 'BAAI/bge-m3',
      inputStrategyName: 'chunked_mean',
      maxInputChars: 5,
      chunkMaxChunks: 2,
      metrics
    })

    let error = null
    try {
      await provider.embed('abcdefghijklmno')
    } catch (caughtError) {
      error = caughtError
    }

    expect(isSemanticInputTooLargeError(error)).toBe(true)
    expect(error.reason).toBe('input_too_large_chunk_count')
    expect(error.details).toEqual(
      expect.objectContaining({
        requiredChunks: 3,
        chunkMaxChunks: 2
      })
    )
    expect(axios.post).not.toHaveBeenCalled()
    expect(metrics.recordAsync).toHaveBeenCalledWith({
      semanticSkips: 1,
      'semanticSkipReason:input_too_large_chunk_count': 1
    })
  })
})
