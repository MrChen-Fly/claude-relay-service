function toSSE(event) {
  return `data: ${JSON.stringify(event)}\n\n`
}

function cloneItem(item = {}, overrides = {}) {
  return {
    ...item,
    ...overrides
  }
}

function buildStreamingResponseEnvelope(responseBody = {}, responseId, createdAt, model) {
  return {
    ...responseBody,
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    model,
    output: []
  }
}

function buildMessageEvents(item, outputIndex) {
  if (!item || typeof item !== 'object') {
    return []
  }

  const itemId = item.id || `msg_${outputIndex}`
  const contentParts = Array.isArray(item.content) ? item.content : []
  const events = [
    toSSE({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: 'in_progress',
        content: []
      })
    })
  ]

  contentParts.forEach((contentPart, contentIndex) => {
    if (
      !contentPart ||
      contentPart.type !== 'output_text' ||
      typeof contentPart.text !== 'string'
    ) {
      return
    }

    events.push(
      toSSE({
        type: 'response.content_part.added',
        item_id: itemId,
        output_index: outputIndex,
        content_index: contentIndex,
        part: {
          type: 'output_text',
          text: ''
        }
      })
    )

    if (contentPart.text) {
      events.push(
        toSSE({
          type: 'response.output_text.delta',
          item_id: itemId,
          output_index: outputIndex,
          content_index: contentIndex,
          delta: contentPart.text
        })
      )
    }

    events.push(
      toSSE({
        type: 'response.output_text.done',
        item_id: itemId,
        output_index: outputIndex,
        content_index: contentIndex,
        text: contentPart.text,
        logprobs: Array.isArray(contentPart.logprobs) ? contentPart.logprobs : []
      })
    )

    events.push(
      toSSE({
        type: 'response.content_part.done',
        item_id: itemId,
        output_index: outputIndex,
        content_index: contentIndex,
        part: contentPart
      })
    )
  })

  events.push(
    toSSE({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: item.status || 'completed'
      })
    })
  )

  return events
}

function buildReasoningEvents(item, outputIndex) {
  if (!item || typeof item !== 'object') {
    return []
  }

  const itemId = item.id || `rsn_${outputIndex}`
  const summaries = Array.isArray(item.summary) ? item.summary : []
  const events = [
    toSSE({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: 'in_progress',
        summary: []
      })
    })
  ]

  summaries.forEach((summaryPart) => {
    if (
      !summaryPart ||
      summaryPart.type !== 'summary_text' ||
      typeof summaryPart.text !== 'string'
    ) {
      return
    }

    if (summaryPart.text) {
      events.push(
        toSSE({
          type: 'response.reasoning_summary_text.delta',
          item_id: itemId,
          output_index: outputIndex,
          delta: summaryPart.text
        })
      )
    }

    events.push(
      toSSE({
        type: 'response.reasoning_summary_text.done',
        item_id: itemId,
        output_index: outputIndex,
        text: summaryPart.text
      })
    )
  })

  events.push(
    toSSE({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: item.status || 'completed'
      })
    })
  )

  return events
}

function buildFunctionCallEvents(item, outputIndex) {
  if (!item || typeof item !== 'object') {
    return []
  }

  const itemId = item.id || `fc_${outputIndex}`
  const argumentsText =
    typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
  const events = [
    toSSE({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: 'in_progress',
        arguments: ''
      })
    })
  ]

  if (argumentsText) {
    events.push(
      toSSE({
        type: 'response.function_call_arguments.delta',
        item_id: itemId,
        output_index: outputIndex,
        delta: argumentsText
      })
    )
  }

  events.push(
    toSSE({
      type: 'response.function_call_arguments.done',
      item_id: itemId,
      output_index: outputIndex,
      arguments: argumentsText || '{}'
    })
  )

  events.push(
    toSSE({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: cloneItem(item, {
        id: itemId,
        status: item.status || 'completed',
        arguments: argumentsText || '{}'
      })
    })
  )

  return events
}

function buildCachedResponsesStreamEvents(responseBody = {}) {
  if (!responseBody || typeof responseBody !== 'object') {
    return []
  }

  const responseId = responseBody.id || `resp_${Date.now()}`
  const createdAt =
    typeof responseBody.created_at === 'string'
      ? responseBody.created_at
      : new Date(
          typeof responseBody.created === 'number' ? responseBody.created * 1000 : Date.now()
        ).toISOString()
  const model = responseBody.model || 'unknown'
  const outputItems = Array.isArray(responseBody.output) ? responseBody.output : []
  const inProgressResponse = buildStreamingResponseEnvelope(
    responseBody,
    responseId,
    createdAt,
    model
  )
  const events = [
    toSSE({
      type: 'response.created',
      response: inProgressResponse
    }),
    toSSE({
      type: 'response.in_progress',
      response: inProgressResponse
    })
  ]

  outputItems.forEach((item, outputIndex) => {
    if (!item || typeof item !== 'object') {
      return
    }

    if (item.type === 'message') {
      events.push(...buildMessageEvents(item, outputIndex))
      return
    }

    if (item.type === 'reasoning') {
      events.push(...buildReasoningEvents(item, outputIndex))
      return
    }

    if (item.type === 'function_call') {
      events.push(...buildFunctionCallEvents(item, outputIndex))
      return
    }

    events.push(
      toSSE({
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: cloneItem(item, {
          status: item.status || 'completed'
        })
      })
    )
  })

  events.push(
    toSSE({
      type: 'response.completed',
      response: responseBody
    })
  )

  return events
}

module.exports = {
  buildCachedResponsesStreamEvents
}
