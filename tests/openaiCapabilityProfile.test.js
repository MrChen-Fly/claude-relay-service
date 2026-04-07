const {
  inferRequestCapabilities,
  inferAccountCapabilities,
  getCapabilityMismatchReasons
} = require('../src/services/openaiProtocol/capabilityProfile')

describe('openai capability profile', () => {
  it('infers responses request capabilities', () => {
    const profile = inferRequestCapabilities(
      {
        stream: false,
        tools: [{ type: 'function', function: { name: 'lookup' } }],
        reasoning: { effort: 'medium' },
        text: {
          format: {
            type: 'json_schema',
            schema: { type: 'object' }
          }
        }
      },
      'responses'
    )

    expect(profile).toEqual({
      clientProtocol: 'responses',
      needsStreaming: false,
      needsTools: true,
      needsReasoning: true,
      needsJsonSchema: true
    })
  })

  it('defaults completions upstream accounts to no json_schema support unless explicitly enabled', () => {
    const accountCapabilities = inferAccountCapabilities(
      {
        providerEndpoint: 'completions'
      },
      'openai-responses'
    )

    expect(accountCapabilities).toMatchObject({
      providerEndpoint: 'completions',
      supportsStreaming: true,
      supportsTools: true,
      supportsReasoning: true,
      supportsJsonSchema: false
    })
  })

  it('respects explicit account capability overrides', () => {
    const accountCapabilities = inferAccountCapabilities(
      {
        providerEndpoint: 'completions',
        supportsJsonSchema: 'true'
      },
      'openai-responses'
    )

    expect(
      getCapabilityMismatchReasons(
        {
          needsStreaming: true,
          needsTools: false,
          needsReasoning: false,
          needsJsonSchema: true
        },
        accountCapabilities
      )
    ).toEqual([])
  })
})
