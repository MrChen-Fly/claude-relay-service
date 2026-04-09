const { buildCacheBypassSummary } = require('../src/services/cache/openaiCacheCanonicalizer')

describe('openaiCacheCanonicalizer buildCacheBypassSummary', () => {
  it('summarizes tool and input shapes without including prompt content', () => {
    const summary = buildCacheBypassSummary({
      model: 'gpt-5',
      stream: false,
      input: [
        {
          role: 'developer',
          content: [{ type: 'input_text', text: 'keep output stable' }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hello world' }]
        }
      ],
      tools: [
        {
          name: 'echo_note',
          description: 'Echo a note string back to the caller when explicitly needed.',
          parameters: {
            type: 'object',
            properties: {
              note: { type: 'string' }
            },
            required: ['note']
          },
          strict: true
        }
      ],
      tool_choice: {
        name: 'echo_note'
      },
      metadata: {
        request_id: 'req_123'
      }
    })

    expect(summary).toMatchObject({
      hasTools: true,
      toolCount: 1,
      toolTypes: ['function'],
      normalizedToolCount: 1,
      toolChoiceMode: 'function:echo_note',
      parallelToolCalls: true,
      inputContainer: 'input_array',
      inputItemKinds: ['message'],
      inputRoles: ['system', 'user'],
      contentPartTypes: ['input_text', 'text'],
      structuredOutput: false,
      hasBackground: false,
      hasWebSearchOptions: false
    })
    expect(summary.topLevelKeys).toEqual(
      expect.arrayContaining(['input', 'metadata', 'model', 'stream', 'tool_choice', 'tools'])
    )
    expect(summary.shapeHash).toMatch(/^[a-f0-9]{16}$/)
  })

  it('marks structured output and realtime search flags in the request summary', () => {
    const summary = buildCacheBypassSummary({
      model: 'gpt-5',
      input: 'hello world',
      web_search_options: {
        search_context_size: 'high'
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'answer'
        }
      }
    })

    expect(summary).toMatchObject({
      hasTools: false,
      toolCount: 0,
      toolChoiceMode: 'auto',
      inputContainer: 'input_string',
      inputItemKinds: ['string'],
      contentPartTypes: ['text'],
      structuredOutput: true,
      hasWebSearchOptions: true
    })
  })
})
