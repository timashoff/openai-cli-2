/**
 * Message utilities - Unified message preparation for streaming
 * Functional approach (NO CLASSES per CLAUDE.md!)
 * Single Source of Truth for message preparation logic
 */

/**
 * Prepare messages for streaming requests
 * Combines context history with new user content
 */
export function prepareStreamingMessages(stateManager, content) {
  const contextHistory = stateManager.getContextHistory()
  const messages = contextHistory.map(({ role, content }) => ({ role, content }))
  messages.push({ role: 'user', content })
  return messages
}