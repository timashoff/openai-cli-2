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
