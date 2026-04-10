const CodexToOpenAIConverter = require('../src/services/codexToOpenAI')
const { evaluateTokenCacheRequest } = require('../src/services/tokenCache/requestTextExtractor')

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

describe('requestTextExtractor codex request shapes', () => {
  it('keeps codex requests with declared tools exact-cacheable', () => {
    const evaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [{ role: 'user', content: 'Search the repo for token cache hooks.' }],
        tools: [buildSearchTool()],
        tool_choice: {
          type: 'function',
          function: {
            name: 'mcp__workspace__search_files'
          }
        },
        prompt_cache_key: 'codex-tools-1'
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

  it('bypasses codex responses requests with tool call history', () => {
    const evaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [
          { role: 'user', content: 'Find every token cache integration point.' },
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
          { role: 'user', content: 'Summarize the relevant files.' }
        ],
        prompt_cache_key: 'codex-tools-2'
      })
    })

    expect(evaluation).toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'stateful_conversation'
      })
    )
  })

  it('normalizes chat tool call ids out of the exact cache fingerprint', () => {
    const buildChatEvaluation = (toolCallId, query) =>
      evaluateTokenCacheRequest({
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
                  id: toolCallId,
                  type: 'function',
                  function: {
                    name: 'mcp__workspace__search_files',
                    arguments: JSON.stringify({ query })
                  }
                }
              ]
            },
            {
              role: 'tool',
              tool_call_id: toolCallId,
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
      })

    const firstEvaluation = buildChatEvaluation('call_search_1', 'token cache')
    const secondEvaluation = buildChatEvaluation('call_search_2', 'token cache')
    const thirdEvaluation = buildChatEvaluation('call_search_3', 'semantic cache')

    expect(firstEvaluation).toEqual(
      expect.objectContaining({
        eligible: true,
        semanticEligible: false,
        cacheStrategy: 'exact_only'
      })
    )
    expect(firstEvaluation.exactKeyInput).toBe(secondEvaluation.exactKeyInput)
    expect(firstEvaluation.exactKeyInput).not.toBe(thirdEvaluation.exactKeyInput)
  })

  it('bypasses ultra-long deterministic codex requests once they carry conversation history', () => {
    const ultraLongPrompt = Array.from(
      { length: 4096 },
      (_, index) => `Segment ${index} traces the token cache boundary carefully.`
    ).join(' ')

    const firstEvaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [
          { role: 'user', content: 'Draft a cache validation plan.' },
          { role: 'assistant', content: 'Which parts should I focus on first?' },
          { role: 'user', content: ultraLongPrompt }
        ],
        prompt_cache_key: 'codex-long-1'
      })
    })

    const secondEvaluation = evaluateTokenCacheRequest({
      endpointPath: '/v1/responses',
      requestBody: buildCodexResponsesBody({
        messages: [
          { role: 'user', content: 'Draft a cache validation plan.' },
          { role: 'assistant', content: 'Should I focus on tools, long prompts, or both?' },
          { role: 'user', content: ultraLongPrompt }
        ],
        prompt_cache_key: 'codex-long-2'
      })
    })

    expect(firstEvaluation).toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'stateful_conversation'
      })
    )
    expect(secondEvaluation).toEqual(
      expect.objectContaining({
        eligible: false,
        reason: 'stateful_conversation'
      })
    )
  })
})
