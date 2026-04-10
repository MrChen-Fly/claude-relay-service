const {
  extractToolResultCacheCandidates
} = require('../src/services/tokenCache/toolResultCacheCandidateExtractor')

describe('toolResultCacheCandidateExtractor', () => {
  it('extracts stable candidates from responses tool history', () => {
    const firstCandidates = extractToolResultCacheCandidates({
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
            arguments: JSON.stringify({ query: 'token cache', limit: 5 })
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

    const secondCandidates = extractToolResultCacheCandidates({
      endpointPath: '/v1/responses',
      requestBody: {
        model: 'gpt-5',
        tools: [
          {
            type: 'function',
            function: {
              name: 'mcp__workspace__search_files',
              parameters: {
                required: ['query'],
                properties: {
                  query: { type: 'string' }
                },
                type: 'object'
              }
            }
          }
        ],
        input: [
          {
            type: 'function_call',
            call_id: 'call_search_2',
            name: 'mcp__workspace__search_files',
            arguments: JSON.stringify({ limit: 5, query: 'token cache' })
          },
          {
            type: 'function_call_output',
            call_id: 'call_search_2',
            output: JSON.stringify({
              matches: ['src/services/tokenCache/requestTextExtractor.js']
            })
          }
        ]
      }
    })

    expect(firstCandidates).toHaveLength(1)
    expect(firstCandidates[0]).toEqual(
      expect.objectContaining({
        toolName: 'mcp__workspace__search_files',
        canonicalArguments: JSON.stringify({ limit: 5, query: 'token cache' }),
        canonicalOutput: JSON.stringify({
          matches: ['src/services/tokenCache/requestTextExtractor.js']
        })
      })
    )
    expect(firstCandidates[0].keyInput).toBe(secondCandidates[0].keyInput)
  })

  it('extracts stable candidates from chat tool history', () => {
    const firstCandidates = extractToolResultCacheCandidates({
      endpointPath: '/v1/chat/completions',
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
                }
              }
            }
          }
        ],
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_search_1',
                type: 'function',
                function: {
                  name: 'mcp__workspace__search_files',
                  arguments: JSON.stringify({ query: 'semantic cache' })
                }
              }
            ]
          },
          {
            role: 'tool',
            tool_call_id: 'call_search_1',
            content: JSON.stringify({
              matches: ['src/services/tokenCache/semanticTokenCacheEngine.js']
            })
          }
        ]
      }
    })

    const secondCandidates = extractToolResultCacheCandidates({
      endpointPath: '/v1/chat/completions',
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
                }
              }
            }
          }
        ],
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_search_2',
                type: 'function',
                function: {
                  name: 'mcp__workspace__search_files',
                  arguments: JSON.stringify({ query: 'semantic cache' })
                }
              }
            ]
          },
          {
            role: 'tool',
            tool_call_id: 'call_search_2',
            content: JSON.stringify({
              matches: ['src/services/tokenCache/semanticTokenCacheEngine.js']
            })
          }
        ]
      }
    })

    expect(firstCandidates).toHaveLength(1)
    expect(firstCandidates[0].toolCallId).toBe('call_search_1')
    expect(firstCandidates[0].keyInput).toBe(secondCandidates[0].keyInput)
  })
})
