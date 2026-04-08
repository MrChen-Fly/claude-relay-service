const openaiResponsesAccountService = require('../src/services/account/openaiResponsesAccountService')

describe('openaiResponsesAccountService optional capability normalization', () => {
  it.each([
    [true, 'true'],
    [false, 'false'],
    ['true', 'true'],
    ['false', 'false'],
    ['1', 'true'],
    ['0', 'false'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    ['unexpected', '']
  ])('normalizes %p to %p', (input, expected) => {
    expect(openaiResponsesAccountService._normalizeOptionalCapability(input)).toBe(expected)
  })

  it('normalizes model mapping payloads and filters empty entries', () => {
    expect(
      openaiResponsesAccountService._processModelMapping({
        'gpt-5': 'codex-0.80',
        '': 'ignored',
        'o4-mini': ''
      })
    ).toEqual({
      'gpt-5': 'codex-0.80'
    })
  })

  it('treats empty model mapping as support-all and resolves exact/case-insensitive matches', () => {
    expect(openaiResponsesAccountService.isModelSupported({}, 'gpt-5')).toBe(true)
    expect(
      openaiResponsesAccountService.isModelSupported(
        {
          'gpt-5': 'codex-0.80'
        },
        'GPT-5'
      )
    ).toBe(true)
    expect(
      openaiResponsesAccountService.getMappedModel(
        {
          'gpt-5': 'codex-0.80'
        },
        'GPT-5'
      )
    ).toBe('codex-0.80')
  })

  it('treats mapped upstream model values as supported client model aliases', () => {
    expect(
      openaiResponsesAccountService.isModelSupported(
        {
          'gpt-5.4': 'mimo-v2-pro'
        },
        'mimo-v2-pro'
      )
    ).toBe(true)
  })
})
