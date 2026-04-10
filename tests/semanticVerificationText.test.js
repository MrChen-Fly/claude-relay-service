const {
  buildSemanticVerificationText,
  evaluateLongPromptCompatibility
} = require('../src/services/tokenCache/semanticVerificationText')

describe('semanticVerificationText', () => {
  it('builds a richer long-prompt summary with multiple excerpts', () => {
    const prompt = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-a-123456789 validates long prompt summary generation.`
    ).join(' ')

    const summary = buildSemanticVerificationText(prompt)

    expect(summary).toContain('[LONG PROMPT SUMMARY]')
    expect(summary).toContain('structured_tokens=semantic-run-a-123456789')
    expect(summary).toContain('head_excerpt=')
    expect(summary).toContain('middle_excerpt=')
    expect(summary).toContain('tail_excerpt=')
    expect(summary).toContain('excerpt_2_excerpt=')
    expect(summary).toContain('excerpt_4_excerpt=')
  })

  it('accepts safe long-prompt variants with matching anchors and high excerpt overlap', () => {
    const basePrompt = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-a-123456789 validates long prompt reuse safely.`
    ).join(' ')
    const variantPrompt = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-a-123456789 ${
          index % 40 === 0
            ? 'uses variant wording for verification coverage.'
            : 'validates long prompt reuse safely.'
        }`
    ).join(' ')

    const result = evaluateLongPromptCompatibility(basePrompt, variantPrompt)

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true
      })
    )
  })

  it('rejects long-prompt variants when structured anchors diverge', () => {
    const promptA = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-a-123456789 validates long prompt reuse safely.`
    ).join(' ')
    const promptB = Array.from(
      { length: 900 },
      (_, index) =>
        `Segment ${index} for semantic-run-b-987654321 validates long prompt reuse safely.`
    ).join(' ')

    const result = evaluateLongPromptCompatibility(promptA, promptB)

    expect(result).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: 'structured_tokens'
      })
    )
  })
})
