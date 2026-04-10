const { cosineSimilarity } = require('./vector')

class EmbeddingAnnIndex {
  constructor() {
    this.vectors = new Map()
  }

  add(key, vector) {
    this.vectors.set(key, vector)
  }

  remove(key) {
    this.vectors.delete(key)
  }

  getVector(key) {
    return this.vectors.get(key) || null
  }

  search(vector, limit = 1) {
    if (!Array.isArray(vector) || vector.length === 0 || this.vectors.size === 0) {
      return {
        keys: [],
        distances: []
      }
    }

    const results = Array.from(this.vectors.entries())
      .map(([key, candidate]) => ({
        key,
        distance: 1 - cosineSimilarity(vector, candidate)
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, Math.max(1, limit))

    return {
      keys: results.map((item) => item.key),
      distances: results.map((item) => item.distance)
    }
  }

  size() {
    return this.vectors.size
  }
}

module.exports = EmbeddingAnnIndex
