// Prepare messages for streaming requests.
// Prepends chat history only when includeContext is true (stateless commands skip it).
export function prepareStreamingMessages(stateManager, content, includeContext = true) {
  const messages = []
  if (includeContext) {
    const history = stateManager.getContextHistory()
    for (const entry of history) {
      messages.push({ role: entry.role, content: entry.content })
    }
  }
  messages.push({ role: 'user', content })
  return messages
}
