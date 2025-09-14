/**
 * Streaming utilities - Unified streaming request execution
 * Functional approach (NO CLASSES per CLAUDE.md!)
 * Single Source of Truth for streaming request logic
 */

/**
 * Execute streaming request to AI models
 * Creates streaming chat completion with abort signal support
 */
export async function executeStreamingRequest(stateManager, messages, controller, providerModel = null) {
  return await stateManager.createChatCompletion(messages, {
    stream: true,
    signal: controller.signal
  }, providerModel)
}