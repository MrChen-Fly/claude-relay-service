const {
  buildCacheBypassSummary,
  buildCanonicalPrompt,
  buildToolProfile
} = require('../src/services/cache/openaiCacheCanonicalizer')

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

  it('treats Codex-style tool bundles as cache-safe definitions', () => {
    const toolProfile = buildToolProfile({
      model: 'gpt-5.4',
      tools: [
        {
          type: 'function',
          name: 'shell_command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' }
            }
          }
        },
        {
          type: 'custom',
          name: 'apply_patch',
          format: {
            type: 'grammar',
            syntax: 'lark',
            definition: 'start: "patch"'
          }
        },
        {
          type: 'web_search',
          search_context_size: 'medium',
          external_web_access: true
        }
      ],
      tool_choice: 'auto'
    })

    expect(toolProfile).toMatchObject({
      supported: true,
      hasTools: true,
      choiceMode: 'auto',
      parallelToolCalls: true
    })
    expect(toolProfile.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'shell_command' })
        }),
        expect.objectContaining({
          type: 'custom',
          name: 'apply_patch',
          format: expect.objectContaining({
            syntax: 'lark',
            type: 'grammar'
          })
        }),
        expect.objectContaining({
          type: 'web_search',
          external_web_access: true,
          search_context_size: 'medium'
        })
      ])
    )
  })

  it('builds canonical prompt text for tool call history without treating reasoning as unsupported', () => {
    const canonicalPrompt = buildCanonicalPrompt({
      model: 'gpt-5.4',
      instructions: 'keep output stable',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '检查缓存命中率' }]
        },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'internal reasoning' }]
        },
        {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{ "command": "rg openai_cache_bypass_detail" }'
        },
        {
          type: 'function_call_output',
          output: {
            exit_code: 0,
            stdout: 'reason: tool_custom'
          }
        },
        {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: '*** Begin Patch'
        },
        {
          type: 'custom_tool_call_output',
          output: 'Success'
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '继续' }]
        }
      ]
    })

    expect(canonicalPrompt.supported).toBe(true)
    expect(canonicalPrompt.text).toContain('system: keep output stable')
    expect(canonicalPrompt.text).toContain('user: 检查缓存命中率')
    expect(canonicalPrompt.text).toContain(
      'assistant: function_call:shell_command {"command":"rg openai_cache_bypass_detail"}'
    )
    expect(canonicalPrompt.text).toContain(
      'tool: function_call_output {"exit_code":0,"stdout":"reason: tool_custom"}'
    )
    expect(canonicalPrompt.text).toContain(
      'assistant: custom_tool_call:apply_patch *** Begin Patch'
    )
    expect(canonicalPrompt.text).toContain('tool: custom_tool_call_output Success')
    expect(canonicalPrompt.text).not.toContain('internal reasoning')
    expect(canonicalPrompt.focalText).toBe('继续')
  })
})
