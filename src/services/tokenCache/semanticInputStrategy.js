function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function toNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function splitTextIntoFixedChunks(text, maxChars, overlapChars = 0) {
  const normalizedText = typeof text === 'string' ? text : String(text || '')
  const chunkSize = toPositiveInteger(maxChars)
  if (!normalizedText || chunkSize <= 0) {
    return []
  }

  const overlap = Math.min(toNonNegativeInteger(overlapChars), Math.max(0, chunkSize - 1))
  const step = Math.max(1, chunkSize - overlap)
  const chunks = []

  for (let start = 0; start < normalizedText.length; start += step) {
    const chunk = normalizedText.slice(start, start + chunkSize)
    if (!chunk) {
      break
    }

    chunks.push(chunk)
    if (start + chunkSize >= normalizedText.length) {
      break
    }
  }

  return chunks
}

function weightedMeanPoolEmbeddings(embeddingItems = []) {
  if (!Array.isArray(embeddingItems) || embeddingItems.length === 0) {
    return []
  }

  const dimension = embeddingItems[0]?.embedding?.length || 0
  if (!dimension) {
    return []
  }

  const pooled = new Array(dimension).fill(0)
  let totalWeight = 0

  for (const item of embeddingItems) {
    const embedding = Array.isArray(item?.embedding) ? item.embedding : []
    if (embedding.length !== dimension) {
      throw new Error('semantic chunk embeddings returned inconsistent dimensions')
    }

    const weight = Math.max(1, Number(item?.weight) || 0)
    totalWeight += weight

    for (let index = 0; index < dimension; index += 1) {
      pooled[index] += Number(embedding[index] || 0) * weight
    }
  }

  if (!totalWeight) {
    return pooled
  }

  return pooled.map((value) => value / totalWeight)
}

function createSkipStrategy() {
  return {
    name: 'skip',
    async embed({ text, preflightLimitError, requestEmbedding }) {
      if (preflightLimitError) {
        throw preflightLimitError
      }

      return requestEmbedding(text)
    }
  }
}

function splitChunkForRetry(text) {
  const normalizedText = typeof text === 'string' ? text : String(text || '')
  if (normalizedText.length <= 1) {
    return []
  }

  return splitTextIntoFixedChunks(normalizedText, Math.ceil(normalizedText.length / 2), 0)
}

function createChunkedMeanStrategy(options = {}) {
  const configuredMaxInputChars = toPositiveInteger(options.maxInputChars)
  const chunkMaxChunks = toPositiveInteger(options.chunkMaxChunks)
  const chunkOverlapChars = toNonNegativeInteger(options.chunkOverlapChars)

  return {
    name: 'chunked_mean',
    async embed({
      text,
      preflightLimitError,
      maxInputChars: runtimeMaxInputChars,
      requestEmbedding,
      createInputTooLargeError,
      recordMetrics,
      shouldRetryWithSmallerChunk
    }) {
      const effectiveMaxInputChars =
        toPositiveInteger(runtimeMaxInputChars) || configuredMaxInputChars

      if (!preflightLimitError) {
        return requestEmbedding(text)
      }

      if (preflightLimitError.reason !== 'input_too_large_config_chars') {
        throw preflightLimitError
      }

      if (effectiveMaxInputChars <= 0) {
        throw createInputTooLargeError(
          'input_too_large_chunking_requires_char_limit',
          'chunked semantic strategy requires maxInputChars > 0',
          {
            strategy: 'chunked_mean'
          }
        )
      }

      if (chunkMaxChunks <= 0) {
        throw createInputTooLargeError(
          'input_too_large_chunking_requires_chunk_limit',
          'chunked semantic strategy requires chunkMaxChunks > 0',
          {
            strategy: 'chunked_mean',
            chunkSizeChars: effectiveMaxInputChars
          }
        )
      }

      const chunks = splitTextIntoFixedChunks(text, effectiveMaxInputChars, chunkOverlapChars)
      if (chunks.length > chunkMaxChunks) {
        throw createInputTooLargeError(
          'input_too_large_chunk_count',
          `semantic input requires ${chunks.length} chunks, exceeds chunkMaxChunks (${chunkMaxChunks})`,
          {
            strategy: 'chunked_mean',
            requiredChunks: chunks.length,
            chunkMaxChunks,
            chunkSizeChars: effectiveMaxInputChars,
            chunkOverlapChars
          }
        )
      }

      const pendingChunks = [...chunks]
      recordMetrics({
        semanticChunkedRequests: 1,
        semanticChunkedChunks: pendingChunks.length
      })

      const embeddingItems = []
      while (pendingChunks.length > 0) {
        const chunk = pendingChunks.shift()

        try {
          const embedding = await requestEmbedding(chunk)
          embeddingItems.push({
            embedding,
            weight: chunk.length
          })
          continue
        } catch (error) {
          const retryChunking =
            typeof shouldRetryWithSmallerChunk === 'function' &&
            shouldRetryWithSmallerChunk(error, {
              text: chunk,
              charCount: chunk.length
            })

          if (!retryChunking) {
            throw error
          }

          const smallerChunks = splitChunkForRetry(chunk)
          if (smallerChunks.length <= 1) {
            throw error
          }

          const projectedChunkCount =
            embeddingItems.length + pendingChunks.length + smallerChunks.length
          if (projectedChunkCount > chunkMaxChunks) {
            throw createInputTooLargeError(
              'input_too_large_chunk_count',
              `semantic input requires ${projectedChunkCount} chunks, exceeds chunkMaxChunks (${chunkMaxChunks})`,
              {
                strategy: 'chunked_mean',
                requiredChunks: projectedChunkCount,
                chunkMaxChunks,
                chunkSizeChars: effectiveMaxInputChars,
                chunkOverlapChars,
                adaptiveSplit: true,
                retryChunkChars: chunk.length,
                retryChunkSizeChars: smallerChunks[0]?.length || 0
              }
            )
          }

          recordMetrics({
            semanticChunkedChunks: smallerChunks.length - 1
          })
          pendingChunks.unshift(...smallerChunks)
        }
      }

      return weightedMeanPoolEmbeddings(embeddingItems)
    }
  }
}

function createSemanticInputStrategy(options = {}) {
  const strategyName = String(options.name || 'skip')
    .trim()
    .toLowerCase()

  if (strategyName === 'chunked_mean') {
    return createChunkedMeanStrategy(options)
  }

  return createSkipStrategy()
}

module.exports = {
  createSemanticInputStrategy,
  createSkipStrategy,
  createChunkedMeanStrategy,
  splitTextIntoFixedChunks,
  weightedMeanPoolEmbeddings
}
