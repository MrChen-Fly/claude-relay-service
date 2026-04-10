jest.mock('../src/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}))

const PromptCacheTokenCacheProvider = require('../src/services/tokenCache/promptCacheTokenCacheProvider')
const ExactTokenCache = require('../src/services/tokenCache/exactTokenCache')
const SemanticTokenCacheEngine = require('../src/services/tokenCache/semanticTokenCacheEngine')
const StorageBackedToolResultCacheProvider = require('../src/services/tokenCache/storageBackedToolResultCacheProvider')
const { SemanticInputTooLargeError } = require('../src/services/tokenCache/semanticProviderErrors')
const { evaluateTokenCacheRequest } = require('../src/services/tokenCache/requestTextExtractor')
const CodexToOpenAIConverter = require('../src/services/codexToOpenAI')
const logger = require('../src/utils/logger')

class MemoryTokenCacheStorage {
  constructor() {
    this.data = new Map()
  }

  _buildKey(kind, key) {
    return `${kind}:${key}`
  }

  async set(kind, key, value) {
    this.data.set(this._buildKey(kind, key), value)
  }

  async get(kind, key) {
    return this.data.get(this._buildKey(kind, key)) || null
  }

  async delete(key) {
    this.data.delete(this._buildKey('entry', key))
    this.data.delete(this._buildKey('prompt', key))
    for (const storageKey of Array.from(this.data.keys())) {
      if (storageKey.startsWith(`embedding:`) && storageKey.endsWith(`:${key}`)) {
        this.data.delete(storageKey)
      }
    }
  }

  async getAllEmbeddings(scopeKey) {
    const prefix = this._buildKey('embedding', `${scopeKey}:`)
    return new Map(
      Array.from(this.data.entries()).filter(([storageKey]) => storageKey.startsWith(prefix))
    )
  }

  async getPrompt(key) {
    const value = await this.get('prompt', key)
    return value?.promptText || ''
  }
}

function buildCodexResponsesBody(overrides = {}) {
  const converter = new CodexToOpenAIConverter()
  return converter.buildRequestFromOpenAI({
    model: 'gpt-5',
    stream: false,
    temperature: 0,
    ...overrides
  })
}

function buildSearchTool(name = 'mcp__workspace__search_files') {
  return {
    type: 'function',
    function: {
      name,
      description: 'Search the workspace for matching files.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }
}

describe('prompt-cache token cache provider', () => {
  it('accepts deterministic plain-text responses requests', () => {
    const evaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Explain quantum physics' }]
          }
        ],
        stream: false
      }
    })

    expect(evaluation).toEqual(
      expect.objectContaining({
        eligible: true,
        promptText: 'Explain quantum physics'
      })
    )
    expect(evaluation.scopeKey).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps streaming requests eligible when the prompt is cacheable', () => {
    const evaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Summarize the launch notes' }]
          }
        ],
        stream: true
      }
    })

    expect(evaluation).toEqual(
      expect.objectContaining({
        eligible: true,
        promptText: 'Summarize the launch notes'
      })
    )
  })

  it('uses the last user prompt as the prompt-cache key input', () => {
    const firstEvaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Draft an outline' }]
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Sure, what tone do you want?' }]
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Make it concise' }]
          }
        ]
      }
    })

    const secondEvaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Draft an outline' }]
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'What audience is this for?' }]
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Make it concise' }]
          }
        ]
      }
    })

    expect(firstEvaluation.promptText).toBe('Make it concise')
    expect(secondEvaluation.promptText).toBe('Make it concise')
    expect(firstEvaluation.exactKeyInput).toBe(secondEvaluation.exactKeyInput)
  })

  it('keeps tool requests eligible but exact-only', () => {
    const evaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [{ role: 'user', content: 'Search the repo for token cache hooks.' }],
        tools: [buildSearchTool()],
        tool_choice: 'auto'
      })
    })

    expect(evaluation).toEqual(
      expect.objectContaining({
        eligible: true,
        semanticEligible: false,
        cacheStrategy: 'exact_only'
      })
    )
    expect(evaluation.exactKeyInput).toContain('mcp__workspace__search_files')
  })

  it('stores and serves exact hits with prompt-cache semantics', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const diagnostics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      diagnostics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })

    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'Explain quantum physics',
        stream: false
      }
    }

    const storeResult = await provider.store(context, {
      statusCode: 200,
      body: { id: 'resp_1', output_text: 'A physics answer' }
    })

    expect(storeResult).toEqual(
      expect.objectContaining({
        stored: true
      })
    )

    const lookupResult = await provider.lookup(context)
    expect(lookupResult).toEqual(
      expect.objectContaining({
        hit: true,
        statusCode: 200,
        body: { id: 'resp_1', output_text: 'A physics answer' },
        headers: expect.objectContaining({
          'x-token-cache': 'HIT',
          'x-token-cache-layer': 'exact',
          'x-token-cache-provider': 'prompt-cache'
        })
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        stores: 1
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: 1,
        eligibleRequests: 1
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        exactHits: 1
      })
    )
    expect(diagnostics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'store',
        cacheStrategy: 'semantic_first'
      })
    )
    expect(diagnostics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'hit',
        layer: 'exact',
        promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        transcriptHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    )
  })

  it('can fall back to semantic hits within the same scope', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => ({
        cacheKey: 'semantic-key',
        score: 0.91,
        layer: 'semantic'
      })),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })

    await provider.exactCache.set('semantic-key', {
      statusCode: 200,
      body: { id: 'resp_semantic', output_text: 'A cached semantic answer' }
    })

    const lookupResult = await provider.lookup({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'How does quantum physics work?',
        stream: false
      }
    })

    expect(semanticEngine.findSimilar).toHaveBeenCalled()
    expect(lookupResult).toEqual(
      expect.objectContaining({
        hit: true,
        body: { id: 'resp_semantic', output_text: 'A cached semantic answer' },
        headers: expect.objectContaining({
          'x-token-cache-layer': 'semantic'
        })
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        semanticHits: 1
      })
    )
  })

  it('records semantic_reject diagnostics when a long-prompt semantic candidate is rejected', async () => {
    const storage = new MemoryTokenCacheStorage()
    const diagnostics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => ({
        rejectedReason: 'long_prompt_local_gate_structured_tokens',
        score: 0.94,
        candidateCacheKey: 'semantic-key',
        layer: 'semantic'
      })),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      diagnostics,
      metrics: {
        recordAsync: jest.fn()
      },
      semanticEngine
    })
    const longPrompt = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-a-123456789 validates long prompt reuse safely.`
    ).join(' ')

    await expect(
      provider.lookup({
        endpointPath: '/v1/responses',
        requestBody: {
          model: 'gpt-5',
          input: longPrompt,
          stream: false
        }
      })
    ).resolves.toEqual({
      hit: false,
      reason: 'cache_miss'
    })

    expect(diagnostics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'semantic_reject',
        layer: 'semantic',
        reason: 'long_prompt_local_gate_structured_tokens',
        score: 0.94
      })
    )
    expect(diagnostics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'miss',
        reason: 'cache_miss'
      })
    )
  })

  it('prefers semantic lookup before the scoped exact cache when semantic cache is enabled', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => ({
        cacheKey: 'semantic-key',
        score: 0.91,
        layer: 'semantic'
      })),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })

    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Explain quantum physics' }]
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'What depth do you want?' }]
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'How does quantum physics work?' }]
          }
        ],
        stream: false
      }
    }

    const evaluation = evaluateTokenCacheRequest(context)
    const localCacheKey = ExactTokenCache.generateKey(evaluation.exactKeyInput)

    await provider.exactCache.set(localCacheKey, {
      statusCode: 200,
      body: { id: 'resp_exact', output_text: 'A local exact answer' }
    })
    await provider.exactCache.set('semantic-key', {
      statusCode: 200,
      body: { id: 'resp_semantic', output_text: 'A semantic answer' }
    })

    const lookupResult = await provider.lookup(context)

    expect(semanticEngine.findSimilar).toHaveBeenCalledWith(
      expect.objectContaining({
        promptText: 'How does quantum physics work?'
      })
    )
    expect(lookupResult).toEqual(
      expect.objectContaining({
        hit: true,
        body: { id: 'resp_semantic', output_text: 'A semantic answer' },
        headers: expect.objectContaining({
          'x-token-cache-layer': 'semantic'
        })
      })
    )
  })

  it('surfaces verified semantic hits for long prompts as semantic_verified', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => ({
        cacheKey: 'semantic-verified-key',
        score: 0.95,
        layer: 'semantic_verified'
      })),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    const longPrompt = Array.from(
      { length: 900 },
      (_, index) => `Segment ${index} validates long semantic verification reuse.`
    ).join(' ')

    await provider.exactCache.set('semantic-verified-key', {
      statusCode: 200,
      body: { id: 'resp_semantic_verified', output_text: 'A verified semantic answer' }
    })

    const lookupResult = await provider.lookup({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: longPrompt,
        stream: false
      }
    })

    expect(lookupResult).toEqual(
      expect.objectContaining({
        hit: true,
        body: { id: 'resp_semantic_verified', output_text: 'A verified semantic answer' },
        headers: expect.objectContaining({
          'x-token-cache-layer': 'semantic_verified'
        })
      })
    )
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        semanticHits: 1,
        semanticVerifiedHits: 1
      })
    )
  })

  it('keeps the exact response stored when semantic artifacts fail to persist', async () => {
    const storage = new MemoryTokenCacheStorage()
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => null),
      store: jest.fn(async () => {
        throw new Error('semantic provider unavailable')
      })
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })

    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'Explain quantum physics',
        stream: false
      }
    }

    await expect(
      provider.store(context, {
        statusCode: 200,
        body: { id: 'resp_1', output_text: 'A physics answer' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        stored: true
      })
    )

    semanticEngine.isEnabled.mockReturnValue(false)

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        headers: expect.objectContaining({
          'x-token-cache-layer': 'exact'
        })
      })
    )
  })

  it('exact-caches tool requests without invoking semantic lookup', async () => {
    const storage = new MemoryTokenCacheStorage()
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => ({
        cacheKey: 'semantic-key',
        score: 0.98,
        layer: 'semantic'
      })),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics: {
        recordAsync: jest.fn()
      }
    })
    const context = {
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [{ role: 'user', content: 'Search the repo for token cache hooks.' }],
        tools: [buildSearchTool()],
        tool_choice: 'auto'
      })
    }

    await expect(
      provider.store(context, {
        statusCode: 200,
        body: { id: 'resp_tool_1', output_text: 'tool answer' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        stored: true
      })
    )

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        headers: expect.objectContaining({
          'x-token-cache-layer': 'exact'
        })
      })
    )

    expect(semanticEngine.findSimilar).not.toHaveBeenCalled()
    expect(semanticEngine.store).not.toHaveBeenCalled()
  })

  it('falls back to an exact hit when semantic lookup fails', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => {
        throw new Error('provider 413')
      }),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics
    })
    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'Explain quantum physics',
        stream: false
      }
    }

    await provider.store(context, {
      statusCode: 200,
      body: { id: 'resp_1', output_text: 'A physics answer' }
    })

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        headers: expect.objectContaining({
          'x-token-cache-layer': 'exact'
        })
      })
    )

    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        exactHits: 1
      })
    )
  })

  it('falls back to an exact hit when semantic lookup is skipped for oversized input', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => {
        throw new SemanticInputTooLargeError('input too large', {
          reason: 'input_too_large_provider',
          details: { providerStatus: 413 }
        })
      }),
      store: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      metrics
    })
    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'Explain quantum physics',
        stream: false
      }
    }

    await provider.store(context, {
      statusCode: 200,
      body: { id: 'resp_1', output_text: 'A physics answer' }
    })

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        headers: expect.objectContaining({
          'x-token-cache-layer': 'exact'
        })
      })
    )

    expect(logger.info).toHaveBeenCalledWith(
      'Prompt-cache semantic lookup skipped for oversized input',
      expect.objectContaining({
        reason: 'input_too_large_provider'
      })
    )
  })

  it('passes matched tool results to the tool-result cache provider during store', async () => {
    const storage = new MemoryTokenCacheStorage()
    const toolResultCacheProvider = {
      isEnabled: jest.fn(() => true),
      getName: jest.fn(() => 'tool-result-memory'),
      lookupCandidates: jest.fn(async () => ({ hit: false })),
      storeCandidates: jest.fn(async () => ({ stored: true }))
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      toolResultCacheProvider
    })
    const context = {
      endpointPath: '/v1/chat/completions',
      requestBody: {
        model: 'gpt-5',
        temperature: 0,
        tools: [buildSearchTool()],
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_search_1',
                type: 'function',
                function: {
                  name: 'mcp__workspace__search_files',
                  arguments: JSON.stringify({ query: 'token cache' })
                }
              }
            ]
          },
          {
            role: 'tool',
            tool_call_id: 'call_search_1',
            content: JSON.stringify({
              matches: ['src/services/tokenCache/requestTextExtractor.js']
            })
          },
          {
            role: 'user',
            content: 'Summarize the matching files.'
          }
        ]
      }
    }

    await provider.store(context, {
      statusCode: 200,
      body: { id: 'resp_tool_2', output_text: 'tool answer' }
    })

    expect(toolResultCacheProvider.storeCandidates).toHaveBeenCalledWith(
      context,
      [
        expect.objectContaining({
          toolName: 'mcp__workspace__search_files',
          canonicalArguments: JSON.stringify({ query: 'token cache' })
        })
      ],
      expect.objectContaining({
        statusCode: 200
      })
    )
  })

  it('can serve a tool-result hit after exact lookup misses', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const toolResultCacheProvider = {
      isEnabled: jest.fn(() => true),
      getName: jest.fn(() => 'tool-result-memory'),
      lookupCandidates: jest.fn(async () => ({
        hit: true,
        layer: 'tool_result',
        statusCode: 200,
        body: { id: 'resp_tool_hit', output_text: 'tool-result answer' }
      })),
      storeCandidates: jest.fn(async () => ({ stored: false }))
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      toolResultCacheProvider
    })
    const context = {
      endpointPath: '/v1/chat/completions',
      requestBody: {
        model: 'gpt-5',
        temperature: 0,
        tools: [buildSearchTool()],
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_search_1',
                type: 'function',
                function: {
                  name: 'mcp__workspace__search_files',
                  arguments: JSON.stringify({ query: 'token cache' })
                }
              }
            ]
          },
          {
            role: 'tool',
            tool_call_id: 'call_search_1',
            content: JSON.stringify({
              matches: ['src/services/tokenCache/requestTextExtractor.js']
            })
          },
          {
            role: 'user',
            content: 'Summarize the matching files.'
          }
        ]
      }
    }

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        body: { id: 'resp_tool_hit', output_text: 'tool-result answer' },
        headers: expect.objectContaining({
          'x-token-cache-layer': 'tool_result',
          'x-token-cache-provider': 'prompt-cache'
        })
      })
    )

    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        hits: 1,
        toolResultHits: 1
      })
    )
  })

  it('serves a real storage-backed tool-result hit after the exact entry is removed', async () => {
    const storage = new MemoryTokenCacheStorage()
    const metrics = {
      recordAsync: jest.fn()
    }
    const toolResultCacheProvider = new StorageBackedToolResultCacheProvider({
      storage,
      enabled: true,
      ttlSeconds: 3600,
      allowedTools: ['mcp__workspace__search_files']
    })
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      metrics,
      toolResultCacheProvider
    })
    const context = {
      accountId: 'acc-tool-1',
      accountType: 'openai-responses',
      endpointPath: '/v1/chat/completions',
      requestedModel: 'gpt-5',
      requestBody: {
        model: 'gpt-5',
        temperature: 0,
        tools: [buildSearchTool()],
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_search_1',
                type: 'function',
                function: {
                  name: 'mcp__workspace__search_files',
                  arguments: JSON.stringify({ query: 'token cache' })
                }
              }
            ]
          },
          {
            role: 'tool',
            tool_call_id: 'call_search_1',
            content: JSON.stringify({
              matches: ['src/services/tokenCache/requestTextExtractor.js']
            })
          },
          {
            role: 'user',
            content: 'Summarize the matching files.'
          }
        ]
      }
    }

    const storeResult = await provider.store(context, {
      statusCode: 200,
      body: { id: 'resp_tool_real_1', output_text: 'tool-result answer' }
    })
    const evaluation = provider._evaluateContext(context)

    await provider.exactCache.delete(storeResult.cacheKey)

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        body: { id: 'resp_tool_real_1', output_text: 'tool-result answer' },
        headers: expect.objectContaining({
          'x-token-cache-layer': 'tool_result',
          'x-token-cache-tool-result': 'HIT'
        })
      })
    )

    expect(evaluation.toolResultCandidates).toHaveLength(1)
    expect(metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        toolResultStores: 1
      })
    )
  })

  it('records misses for eligible uncached requests', async () => {
    const diagnostics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage: new MemoryTokenCacheStorage(),
      metrics: {
        recordAsync: jest.fn()
      },
      diagnostics
    })

    await provider.lookup({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'hello',
        stream: false
      }
    })

    expect(provider.metrics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        misses: 1
      })
    )
    expect(diagnostics.recordAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'miss',
        reason: 'cache_miss',
        promptLength: 5
      })
    )
  })

  it('stores the prompt before generating embeddings for semantic artifacts', async () => {
    const storage = new MemoryTokenCacheStorage()
    const provider = {
      isEnabled: jest.fn(() => true),
      embed: jest.fn(async () => {
        await expect(storage.getPrompt('cache-key')).resolves.toBe('Explain quantum physics')
        throw new Error('embedding failed')
      }),
      checkSimilarity: jest.fn()
    }
    const engine = new SemanticTokenCacheEngine(storage, provider)

    await expect(
      engine.store({
        scopeKey: 'scope-key',
        cacheKey: 'cache-key',
        promptText: 'Explain quantum physics',
        ttlSeconds: 3600
      })
    ).rejects.toThrow('embedding failed')

    await expect(storage.getPrompt('cache-key')).resolves.toBe('Explain quantum physics')
  })

  it('stores the exact response when semantic artifact creation is skipped for oversized input', async () => {
    const storage = new MemoryTokenCacheStorage()
    const semanticEngine = {
      isEnabled: jest.fn(() => true),
      findSimilar: jest.fn(async () => null),
      store: jest.fn(async () => {
        throw new SemanticInputTooLargeError('input too large', {
          reason: 'input_too_large_config_chars',
          details: { maxInputChars: 1000 }
        })
      })
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage,
      semanticEngine,
      config: {
        ttlSeconds: 3600,
        maxEntries: 100
      }
    })
    const context = {
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'Explain quantum physics',
        stream: false
      }
    }

    await expect(
      provider.store(context, {
        statusCode: 200,
        body: { id: 'resp_1', output_text: 'A physics answer' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        stored: true
      })
    )

    await expect(provider.lookup(context)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        headers: expect.objectContaining({
          'x-token-cache-layer': 'exact'
        })
      })
    )

    expect(logger.info).toHaveBeenCalledWith(
      'Prompt-cache semantic artifact store skipped for oversized input',
      expect.objectContaining({
        reason: 'input_too_large_config_chars'
      })
    )
  })

  it('returns a cache miss for eligible uncached requests', async () => {
    const metrics = {
      recordAsync: jest.fn()
    }
    const provider = new PromptCacheTokenCacheProvider({
      storage: new MemoryTokenCacheStorage(),
      metrics
    })

    const result = await provider.lookup({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        input: 'hello',
        stream: false
      }
    })

    expect(result).toEqual({
      hit: false,
      reason: 'cache_miss'
    })
  })
})
