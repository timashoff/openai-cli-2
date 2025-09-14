/**
 * Context utilities - Unified context management for streaming
 * Functional approach (NO CLASSES per CLAUDE.md!)
 * Single Source of Truth for context update logic
 */

/**
 * Update context for single model responses
 * Adds user input and assistant response to context history
 */
export function updateSingleContext(stateManager, userInput, response) {
  if (response.trim()) {
    stateManager.addToContext('user', userInput)
    stateManager.addToContext('assistant', response)
  }
}

/**
 * Update context for multi-model responses
 * Combines multiple responses and adds to context history
 */
export function updateMultiContext(stateManager, userInput, responses) {
  const combined = responses.join('\n\n')
  if (combined.trim()) {
    stateManager.addToContext('user', userInput)
    stateManager.addToContext('assistant', combined)
  }
}