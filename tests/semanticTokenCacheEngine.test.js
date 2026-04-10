const SemanticTokenCacheEngine = require('../src/services/tokenCache/semanticTokenCacheEngine')

describe('semanticTokenCacheEngine', () => {
  it('resets invalid thresholds back to prompt-cache defaults', () => {
    const engine = new SemanticTokenCacheEngine(
      {
        getAllEmbeddings: jest.fn(),
        getPrompt: jest.fn()
      },
      {
        isEnabled: jest.fn(() => true)
      },
      {
        highThreshold: 0.2,
        lowThreshold: 0.4
      }
    )

    expect(engine.highThreshold).toBe(0.7)
    expect(engine.lowThreshold).toBe(0.3)
  })

  it('records gray-zone checks even when the verifier is disabled', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    const engine = new SemanticTokenCacheEngine(
      {
        getAllEmbeddings: jest.fn(async () => new Map([['embedding:scope:key-1', [1, 0]]])),
        getPrompt: jest.fn()
      },
      {
        isEnabled: jest.fn(() => true),
        embed: jest.fn(async () => [0.5, 0.5]),
        checkSimilarity: jest.fn()
      },
      {
        highThreshold: 0.9,
        lowThreshold: 0.2,
        enableGrayZoneVerifier: false,
        metrics
      }
    )

    await expect(
      engine.findSimilar({
        scopeKey: 'scope',
        promptText: 'gray zone prompt'
      })
    ).resolves.toBeNull()

    expect(metrics.recordAsync).toHaveBeenCalledWith({
      grayZoneChecks: 1
    })
  })

  it('rebuilds a scope-local ANN index from storage and uses it during lookup', async () => {
    const storage = {
      getAllEmbeddingEntries: jest.fn(async () => new Map([['embedding:scope-a:key-1', [1, 0]]])),
      getAllEmbeddings: jest.fn(async () => new Map()),
      getPrompt: jest.fn(async () => 'cached prompt')
    }
    const provider = {
      isEnabled: jest.fn(() => true),
      embed: jest.fn(async () => [1, 0]),
      checkSimilarity: jest.fn()
    }
    const engine = new SemanticTokenCacheEngine(storage, provider, {
      useANNIndex: true,
      highThreshold: 0.7,
      lowThreshold: 0.3
    })

    await expect(
      engine.findSimilar({
        scopeKey: 'scope-a',
        promptText: 'same prompt'
      })
    ).resolves.toEqual({
      cacheKey: 'key-1',
      score: 1,
      layer: 'semantic'
    })

    expect(storage.getAllEmbeddingEntries).toHaveBeenCalled()
    expect(storage.getAllEmbeddings).not.toHaveBeenCalled()
  })
})
