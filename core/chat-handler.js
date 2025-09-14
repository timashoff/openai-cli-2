/**
 * ChatHandler - Pure chat requests without commands
 * Functional object (NO CLASSES per CLAUDE.md!)
 * Handles direct user chat without instruction processing
 */
import { logger } from '../utils/logger.js'
import { createStreamProcessor } from '../utils/stream-processor.js'
import { createSpinner } from '../utils/spinner.js'
import { errorHandler } from './error-system/index.js'
import { outputHandler } from './print/output.js'

export function createChatHandler(app) {

  function prepareRequestMessages(stateManager, input) {
    const contextHistory = stateManager.getContextHistory()
    const messages = contextHistory.map(({ role, content }) => ({ role, content }))
    messages.push({ role: 'user', content: input })
    return messages
  }

  async function executeStreamingRequest(stateManager, messages, controller) {
    return await stateManager.createChatCompletion(messages, {
      stream: true,
      signal: controller.signal
    })
  }

  async function handleStreamResponse(stream, controller, spinner) {
    const streamProcessor = createStreamProcessor()
    const response = []
    let firstChunk = true

    const chunkHandler = async (content) => {
      // Check for abort
      if (controller.signal.aborted) {
        return
      }

      // Stop spinner on first chunk
      if (firstChunk) {
        spinner.stop('success') // ✓ 1.2s
        firstChunk = false
      }

      // Output content directly
      if (content) {
        outputHandler.writeStream(content)
        response.push(content)
      }
    }

    // Process stream with abort handling
    try {
      await streamProcessor.processStream(stream, controller.signal, chunkHandler)
    } catch (streamError) {
      // Handle stream-specific abort errors using unified handler
      const processedError = errorHandler.processError(streamError, { component: 'StreamProcessor' })
      if (!processedError.shouldDisplay) {
        return [] // Silent abort - no error message
      }
      throw streamError // Re-throw other errors
    }

    return response
  }

  function updateContextHistory(stateManager, controller, response, input) {
    if (!controller.signal.aborted) {
      const fullResponse = response.join('')

      // Add newline after LLM response to prevent prompt from overwriting
      if (fullResponse.trim()) {
        process.stdout.write('\n')
      }

      stateManager.addToContext('user', input)
      stateManager.addToContext('assistant', fullResponse)

      // Display context dots after response
      outputHandler.writeContextDots(stateManager)
    }
  }

  async function handleChatRequest(input) {
    // Use StateManager directly instead of ServiceManager
    const stateManager = app.stateManager

    // Get existing abort controller from StateManager (created in ApplicationLoop)
    const controller = stateManager.getCurrentRequestController()
    if (!controller) {
      throw new Error('No abort controller available for request')
    }

    // Create spinner
    const spinner = createSpinner()

    try {

      // Start spinner with ESC handling - UNIFIED!
      spinner.start(controller) // Automatically handles ESC → ☓

      // Prepare messages with context
      const messages = prepareRequestMessages(stateManager, input)

      // Create streaming request with abort signal - use StateManager directly
      const stream = await executeStreamingRequest(stateManager, messages, controller)

      // Process streaming response
      const response = await handleStreamResponse(stream, controller, spinner)

      // Update context history if request wasn't aborted
      updateContextHistory(stateManager, controller, response, input)

    } catch (error) {
      // Check if user cancelled request
      if (controller.signal.aborted) {
        // User pressed ESC - spinner already shows ☓
        return  // Silent exit
      }

      // Real errors need to be shown to user
      const processedError = errorHandler.processError(error, { component: 'ChatHandler' })
      if (spinner.isActive()) {
        spinner.stop('error')
      }
      errorHandler.displayError(processedError)
    } finally {
      // Cleanup: dispose spinner only
      // Processing state will be cleared by ApplicationLoop
      spinner.dispose()
    }
  }

  // Return functional object (NO CLASS!)
  return {
    handle: handleChatRequest
  }
}