const {
  cosineSimilarity,
  rankCandidates
} = require('../src/services/cache/gptcache/similarityEvaluator')

describe('similarityEvaluator', () => {
  it('keeps cosine similarity compatible with the existing L2 behavior', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it('prefers context-matching candidates when semantic similarity is close', () => {
    const result = rankCandidates({
      plan: {
        model: 'gpt-5',
        provider: 'openai-responses',
        endpoint: 'responses',
        queryText: 'user: hello world',
        similarityThreshold: 0.95,
        rankAcceptanceThreshold: 0.9,
        contextFingerprint: 'ctx-match'
      },
      queryEmbedding: [1, 0],
      candidates: [
        {
          entryKey: 'entry-mismatch',
          entry: {
            model: 'gpt-5',
            provider: 'openai-responses',
            endpoint: 'responses',
            requestText: 'user: hello world',
            contextFingerprint: 'ctx-other',
            meta: { createdAt: new Date().toISOString() }
          },
          embedding: [0.97, 0.243]
        },
        {
          entryKey: 'entry-match',
          entry: {
            model: 'gpt-5',
            provider: 'openai-responses',
            endpoint: 'responses',
            requestText: 'user: hello world',
            contextFingerprint: 'ctx-match',
            meta: { createdAt: new Date().toISOString() }
          },
          embedding: [0.96, 0.28]
        }
      ]
    })

    expect(result.accepted.entryKey).toBe('entry-match')
    expect(result.accepted.accepted).toBe(true)
  })

  it('rejects borderline candidates when context conflicts pull the rank below threshold', () => {
    const result = rankCandidates({
      plan: {
        model: 'gpt-5',
        provider: 'openai-responses',
        endpoint: 'responses',
        queryText: 'user: hello world',
        similarityThreshold: 0.95,
        rankAcceptanceThreshold: 0.9,
        contextFingerprint: 'ctx-a'
      },
      queryEmbedding: [1, 0],
      candidates: [
        {
          entryKey: 'entry-conflict',
          entry: {
            model: 'gpt-5',
            provider: 'openai-responses',
            endpoint: 'responses',
            requestText: 'user: hello world',
            contextFingerprint: 'ctx-b',
            meta: { createdAt: new Date().toISOString() }
          },
          embedding: [0.95, 0.312249]
        }
      ]
    })

    expect(result.accepted).toBeNull()
    expect(result.best.entryKey).toBe('entry-conflict')
    expect(result.best.hasContextConflict).toBe(true)
    expect(result.best.score).toBeLessThan(0.9)
  })
})
