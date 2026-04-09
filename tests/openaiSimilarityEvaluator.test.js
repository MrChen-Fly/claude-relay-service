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
        queryText: 'hello world',
        requestText: 'user: hello world',
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
            requestFocalText: 'hello world',
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
            requestFocalText: 'hello world',
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
        queryText: 'hello world',
        requestText: 'user: hello world',
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
            requestFocalText: 'hello world',
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

  it('uses recent user-turn sequence match to soften false context conflicts in multi-turn chats', () => {
    const result = rankCandidates({
      plan: {
        model: 'gpt-5',
        provider: 'openai-responses',
        endpoint: 'responses',
        queryText: '继续优化缓存命中率',
        requestText:
          'system: You are helpful\nuser: 重写缓存面板\nassistant: 已完成\nuser: 继续优化缓存命中率',
        similarityThreshold: 0.95,
        rankAcceptanceThreshold: 0.9,
        contextFingerprint: 'ctx-current'
      },
      queryEmbedding: [1, 0],
      candidates: [
        {
          entryKey: 'entry-sequence-match',
          entry: {
            model: 'gpt-5',
            provider: 'openai-responses',
            endpoint: 'responses',
            requestFocalText: '继续优化缓存命中率',
            requestText:
              'system: You are helpful\nuser: 重写缓存面板\nassistant: 已完成\nuser: 继续优化缓存命中率',
            contextFingerprint: 'ctx-older',
            meta: { createdAt: new Date().toISOString() }
          },
          embedding: [0.955, 0.2966058]
        }
      ]
    })

    expect(result.accepted?.entryKey).toBe('entry-sequence-match')
    expect(result.best.factors.sequenceMatchScore).toBeGreaterThan(0.9)
    expect(result.best.hasContextConflict).toBe(false)
  })
})
