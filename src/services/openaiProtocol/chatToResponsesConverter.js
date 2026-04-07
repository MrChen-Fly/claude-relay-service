function toIsoTimestamp(created) {
  if (typeof created === 'number' && Number.isFinite(created)) {
    return new Date(created * 1000).toISOString()
  }

  const parsed = new Date(created || Date.now())
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }
  return parsed.toISOString()
}

function mapUsage(usage) {
  if (!usage) {
    return undefined
  }

  const result = {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
  }

  if (usage.prompt_tokens_details?.cached_tokens > 0) {
    result.input_tokens_details = {
      cached_tokens: usage.prompt_tokens_details.cached_tokens
    }
  }

  if (usage.completion_tokens_details?.reasoning_tokens > 0) {
    result.output_tokens_details = {
      reasoning_tokens: usage.completion_tokens_details.reasoning_tokens
    }
  }

  return result
}

function normalizeContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return ''
      }
      if (item.type === 'text' && typeof item.text === 'string') {
        return item.text
      }
      if (typeof item.text === 'string') {
        return item.text
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

function mapFinishReason(finishReason) {
  if (finishReason === 'length') {
    return {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }
    }
  }

  if (finishReason === 'content_filter') {
    return {
      status: 'incomplete',
      incomplete_details: { reason: 'content_filter' }
    }
  }

  return { status: 'completed' }
}

class ChatToResponsesConverter {
  createStreamState() {
    return {
      responseId: '',
      model: '',
      created: null,
      content: '',
      reasoning: '',
      usage: null,
      toolCalls: {},
      createdEventSent: false,
      completed: false,
      finishReason: null
    }
  }

  convertResponse(chatResponse, requestedModel) {
    if (!chatResponse || chatResponse.error) {
      return chatResponse
    }

    const choice = chatResponse.choices?.[0] || {}
    const message = choice.message || {}
    const responseId = chatResponse.id || `resp_${Date.now()}`
    const output = this._buildOutputFromMessage(message, responseId)
    const status = mapFinishReason(choice.finish_reason)

    const result = {
      id: responseId,
      object: 'response',
      created_at: toIsoTimestamp(chatResponse.created),
      status: status.status,
      model: chatResponse.model || requestedModel,
      output
    }

    if (status.incomplete_details) {
      result.incomplete_details = status.incomplete_details
    }

    const usage = mapUsage(chatResponse.usage)
    if (usage) {
      result.usage = usage
    }

    return result
  }

  convertStreamChunk(eventData, requestedModel, state) {
    if (!eventData || eventData.error) {
      return [eventData]
    }

    if (eventData.object !== 'chat.completion.chunk') {
      return []
    }

    const events = []

    state.responseId = eventData.id || state.responseId || `resp_${Date.now()}`
    state.model = eventData.model || state.model || requestedModel
    state.created = eventData.created || state.created || Math.floor(Date.now() / 1000)

    if (!state.createdEventSent) {
      state.createdEventSent = true
      events.push({
        type: 'response.created',
        response: {
          id: state.responseId,
          object: 'response',
          created_at: toIsoTimestamp(state.created),
          status: 'in_progress',
          model: state.model,
          output: []
        }
      })
    }

    if (eventData.usage) {
      state.usage = eventData.usage
    }

    const choice = eventData.choices?.[0] || {}
    const delta = choice.delta || {}

    if (delta.reasoning_content) {
      state.reasoning += delta.reasoning_content
      events.push({
        type: 'response.reasoning_summary_text.delta',
        delta: delta.reasoning_content
      })
    }

    if (delta.content) {
      state.content += delta.content
      events.push({
        type: 'response.output_text.delta',
        delta: delta.content
      })
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = Number.isInteger(toolCallDelta.index) ? toolCallDelta.index : 0
        const toolCall =
          state.toolCalls[index] ||
          (state.toolCalls[index] = {
            id: toolCallDelta.id || `call_${index}`,
            call_id: toolCallDelta.id || `call_${index}`,
            name: '',
            arguments: '',
            added: false,
            done: false
          })

        if (toolCallDelta.id) {
          toolCall.id = toolCallDelta.id
          toolCall.call_id = toolCallDelta.id
        }
        if (toolCallDelta.function?.name) {
          toolCall.name = toolCallDelta.function.name
        }

        if (!toolCall.added && (toolCall.id || toolCall.name)) {
          toolCall.added = true
          events.push({
            type: 'response.output_item.added',
            output_index: index,
            item: {
              type: 'function_call',
              id: toolCall.id,
              call_id: toolCall.call_id,
              name: toolCall.name,
              arguments: ''
            }
          })
        }

        if (toolCallDelta.function?.arguments) {
          toolCall.arguments += toolCallDelta.function.arguments
          events.push({
            type: 'response.function_call_arguments.delta',
            item_id: toolCall.id,
            output_index: index,
            delta: toolCallDelta.function.arguments
          })
        }
      }
    }

    if (choice.finish_reason) {
      state.finishReason = choice.finish_reason
      for (const [index, toolCall] of Object.entries(state.toolCalls)) {
        if (toolCall.done) {
          continue
        }
        toolCall.done = true
        events.push({
          type: 'response.output_item.done',
          output_index: Number(index),
          item: {
            type: 'function_call',
            id: toolCall.id,
            call_id: toolCall.call_id,
            name: toolCall.name,
            arguments: toolCall.arguments || '{}'
          }
        })
      }

      events.push({
        type: 'response.completed',
        response: this._buildResponseFromState(state, requestedModel)
      })
      state.completed = true
    }

    return events
  }

  _buildResponseFromState(state, requestedModel) {
    const response = {
      id: state.responseId || `resp_${Date.now()}`,
      object: 'response',
      created_at: toIsoTimestamp(state.created),
      status: mapFinishReason(state.finishReason).status,
      model: state.model || requestedModel,
      output: []
    }

    const status = mapFinishReason(state.finishReason)
    if (status.incomplete_details) {
      response.incomplete_details = status.incomplete_details
    }

    if (state.reasoning) {
      response.output.push({
        type: 'reasoning',
        id: `rs_${response.id}`,
        summary: [
          {
            type: 'summary_text',
            text: state.reasoning
          }
        ]
      })
    }

    if (state.content) {
      response.output.push({
        type: 'message',
        id: `msg_${response.id}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: state.content
          }
        ]
      })
    }

    for (const toolCall of Object.values(state.toolCalls)) {
      response.output.push({
        type: 'function_call',
        id: toolCall.id,
        call_id: toolCall.call_id,
        name: toolCall.name,
        arguments: toolCall.arguments || '{}'
      })
    }

    const usage = mapUsage(state.usage)
    if (usage) {
      response.usage = usage
    }

    return response
  }

  _buildOutputFromMessage(message, responseId) {
    const output = []

    if (message.reasoning_content) {
      output.push({
        type: 'reasoning',
        id: `rs_${responseId}`,
        summary: [
          {
            type: 'summary_text',
            text: message.reasoning_content
          }
        ]
      })
    }

    const content = normalizeContent(message.content)
    if (content) {
      output.push({
        type: 'message',
        id: `msg_${responseId}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content
          }
        ]
      })
    }

    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        output.push({
          type: 'function_call',
          id: toolCall.id,
          call_id: toolCall.id,
          name: toolCall.function?.name,
          arguments: toolCall.function?.arguments || '{}'
        })
      }
    }

    return output
  }
}

module.exports = ChatToResponsesConverter
