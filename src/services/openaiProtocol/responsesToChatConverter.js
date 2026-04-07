function mapMessageRole(role) {
  if (role === 'developer') {
    return 'system'
  }
  return role || 'user'
}

function extractTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    if (content && typeof content === 'object' && typeof content.text === 'string') {
      return content.text
    }
    return ''
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return ''
      }
      if (typeof item.text === 'string') {
        return item.text
      }
      if (typeof item.input_text === 'string') {
        return item.input_text
      }
      if (typeof item.output_text === 'string') {
        return item.output_text
      }
      return ''
    })
    .filter(Boolean)
    .join('')
}

function convertTool(tool) {
  if (!tool || tool.type !== 'function' || !tool.function) {
    return tool
  }

  return {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters || tool.function.input_schema || {}
    }
  }
}

function convertToolChoice(toolChoice) {
  if (toolChoice === undefined || toolChoice === null) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  if (toolChoice.type === 'function') {
    const toolName = toolChoice.name || toolChoice.function?.name
    if (!toolName) {
      return 'auto'
    }
    return {
      type: 'function',
      function: { name: toolName }
    }
  }

  return toolChoice
}

function convertResponseFormat(textConfig) {
  const format = textConfig?.format
  if (!format || !format.type) {
    return undefined
  }

  if (format.type === 'json_object') {
    return { type: 'json_object' }
  }

  if (format.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        strict: format.strict,
        schema: format.schema
      }
    }
  }

  return undefined
}

class ResponsesToChatConverter {
  buildRequestFromResponses(responseBody = {}) {
    const request = {
      model: responseBody.model,
      messages: this._buildMessages(responseBody),
      stream: responseBody.stream !== false
    }

    if (responseBody.max_output_tokens !== undefined) {
      request.max_tokens = responseBody.max_output_tokens
    }
    if (responseBody.temperature !== undefined) {
      request.temperature = responseBody.temperature
    }
    if (responseBody.top_p !== undefined) {
      request.top_p = responseBody.top_p
    }
    if (responseBody.tools) {
      request.tools = responseBody.tools.map(convertTool)
    }
    if (responseBody.tool_choice !== undefined) {
      request.tool_choice = convertToolChoice(responseBody.tool_choice)
    }
    if (responseBody.reasoning?.effort) {
      request.reasoning_effort = responseBody.reasoning.effort
    }

    const responseFormat = convertResponseFormat(responseBody.text)
    if (responseFormat) {
      request.response_format = responseFormat
    }

    const passthroughFields = [
      'user',
      'n',
      'stop',
      'presence_penalty',
      'frequency_penalty',
      'logit_bias',
      'metadata',
      'session_id',
      'conversation_id',
      'prompt_cache_key',
      'prompt_cache_retention'
    ]

    for (const field of passthroughFields) {
      if (responseBody[field] !== undefined) {
        request[field] = responseBody[field]
      }
    }

    return request
  }

  _buildMessages(responseBody) {
    const messages = []

    if (responseBody.instructions) {
      messages.push({
        role: 'system',
        content: responseBody.instructions
      })
    }

    const inputItems = Array.isArray(responseBody.input)
      ? responseBody.input
      : responseBody.input
        ? [responseBody.input]
        : []

    for (const item of inputItems) {
      if (!item || typeof item !== 'object') {
        continue
      }

      if (item.type === 'message') {
        messages.push({
          role: mapMessageRole(item.role),
          content: extractTextContent(item.content)
        })
        continue
      }

      if (item.type === 'function_call') {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: item.call_id || item.id || `call_${messages.length}`,
              type: 'function',
              function: {
                name: item.name,
                arguments:
                  typeof item.arguments === 'string'
                    ? item.arguments
                    : JSON.stringify(item.arguments || {})
              }
            }
          ]
        })
        continue
      }

      if (item.type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: item.call_id || item.id,
          content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output || '')
        })
      }
    }

    return messages
  }
}

module.exports = ResponsesToChatConverter
