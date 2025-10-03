/**
 * Prepare messages for streaming requests
 * Combines context history with new user content
 */
export function prepareStreamingMessages(stateManager, content) {
  const contextHistory = stateManager.getContextHistory()
  const messages = contextHistory.map(({ role, content }) => ({
    role,
    content,
  }))
  messages.push({ role: 'user', content })
  return messages
}

export function prepareResponseInput(history, userText) {
  const input = []

  for (const message of history) {
    if (!message || !message.content) {
      continue
    }

    const text = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.join('\n')
        : String(message.content)

    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const contentType = role === 'assistant' ? 'output_text' : 'input_text'

    input.push({
      role,
      content: [
        {
          type: contentType,
          text,
        },
      ],
    })
  }

  if (userText) {
    input.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: userText,
        },
      ],
    })
  }

  return input
}
