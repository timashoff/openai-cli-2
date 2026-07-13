// Shape one conversation turn for the wire: prior history (possibly empty)
// followed by the new user message.
export function composeTurnMessages(history, content) {
  const messages = []
  for (const entry of history) {
    messages.push({ role: entry.role, content: entry.content })
  }
  messages.push({ role: 'user', content })
  return messages
}

// Prepare messages for streaming requests.
// Prepends chat history only when includeContext is true (stateless commands skip it).
export function prepareStreamingMessages(stateManager, content, includeContext = true) {
  return composeTurnMessages(
    includeContext ? stateManager.getContextHistory() : [],
    content,
  )
}
