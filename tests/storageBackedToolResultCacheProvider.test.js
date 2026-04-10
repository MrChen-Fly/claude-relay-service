const StorageBackedToolResultCacheProvider = require('../src/services/tokenCache/storageBackedToolResultCacheProvider')
const {
  extractToolResultCacheCandidates
} = require('../src/services/tokenCache/toolResultCacheCandidateExtractor')

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
}

function buildContext(accountId = 'acc-1') {
  return {
    accountId,
    accountType: 'openai-responses',
    endpointPath: '/v1/responses',
    requestedModel: 'gpt-5',
    requestBody: {
      model: 'gpt-5'
    }
  }
}

function buildCandidates() {
  return extractToolResultCacheCandidates({
    endpointPath: '/v1/responses',
    requestBody: {
      model: 'gpt-5',
      tools: [
        {
          type: 'function',
          function: {
            name: 'mcp__workspace__search_files',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query']
            }
          }
        }
      ],
      input: [
        {
          type: 'function_call',
          call_id: 'call_search_1',
          name: 'mcp__workspace__search_files',
          arguments: JSON.stringify({ query: 'token cache' })
        },
        {
          type: 'function_call_output',
          call_id: 'call_search_1',
          output: JSON.stringify({
            matches: ['src/services/tokenCache/requestTextExtractor.js']
          })
        }
      ]
    }
  })
}

describe('storageBackedToolResultCacheProvider', () => {
  it('stores and serves allowlisted tool-result responses', async () => {
    const storage = new MemoryTokenCacheStorage()
    const provider = new StorageBackedToolResultCacheProvider({
      storage,
      enabled: true,
      ttlSeconds: 3600,
      allowedTools: ['mcp__workspace__search_files']
    })
    const context = buildContext()
    const candidates = buildCandidates()

    await expect(
      provider.storeCandidates(context, candidates, {
        statusCode: 200,
        body: { id: 'resp_tool_1', output_text: 'tool-result answer' }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        stored: true,
        candidateCount: 1
      })
    )

    await expect(provider.lookupCandidates(context, candidates)).resolves.toEqual(
      expect.objectContaining({
        hit: true,
        layer: 'tool_result',
        body: { id: 'resp_tool_1', output_text: 'tool-result answer' },
        headers: expect.objectContaining({
          'x-token-cache-tool-result': 'HIT'
        })
      })
    )
  })

  it('skips non-allowlisted tools', async () => {
    const storage = new MemoryTokenCacheStorage()
    const provider = new StorageBackedToolResultCacheProvider({
      storage,
      enabled: true,
      ttlSeconds: 3600,
      allowedTools: ['mcp__workspace__read_file']
    })

    await expect(
      provider.storeCandidates(buildContext(), buildCandidates(), { body: {} })
    ).resolves.toEqual(
      expect.objectContaining({
        stored: false,
        reason: 'not_replay_safe'
      })
    )
  })

  it('isolates entries by account id', async () => {
    const storage = new MemoryTokenCacheStorage()
    const provider = new StorageBackedToolResultCacheProvider({
      storage,
      enabled: true,
      ttlSeconds: 3600,
      allowedTools: ['mcp__workspace__search_files']
    })
    const candidates = buildCandidates()

    await provider.storeCandidates(buildContext('acc-1'), candidates, {
      statusCode: 200,
      body: { id: 'resp_tool_1', output_text: 'tool-result answer' }
    })

    await expect(provider.lookupCandidates(buildContext('acc-2'), candidates)).resolves.toEqual(
      expect.objectContaining({
        hit: false
      })
    )
  })
})
