import { logger } from '../utils/logger.js'
import { createStreamProcessor } from '../utils/stream-processor.js'
import { createSpinner } from '../utils/spinner.js'
import { errorHandler } from './error-system/index.js'
import { outputHandler } from './print/index.js'
import { prepareStreamingMessages } from '../utils/message-utils.js'
import { updateContext } from '../utils/context-utils.js'

export function createChatHandler(app) {
  async function handleStreamResponse(stream, controller, spinner) {
    const streamProcessor = createStreamProcessor()

    // Save streamProcessor to StateManager for ESC cleanup
    const stateManager = app.stateManager
    stateManager.setStreamProcessor(streamProcessor)

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
      await streamProcessor.processStream(
        stream,
        controller.signal,
        chunkHandler,
      )
    } catch (streamError) {
      // Handle stream-specific abort errors using unified handler
      const processedError = errorHandler.processError(streamError, {
        component: 'StreamProcessor',
      })
      if (!processedError.shouldDisplay) {
        return [] // Silent abort - no error message
      }
      throw streamError // Re-throw other errors
    }

    return response
  }

  async function handleChatRequest(input) {
    logger.debug('ChatHandler: Processing direct chat request')

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

      // AbortSignal automatically managed via Event-Driven StateManager
      // (No manual outputHandler.setAbortSignal needed)

      // Prepare messages with context
      const messages = prepareStreamingMessages(stateManager, input)

      // Create streaming request with abort signal - use StateManager directly
      const stream = await stateManager.createChatCompletion(messages, {
        stream: true,
        signal: controller.signal
      })

      // Process streaming response
      const response = await handleStreamResponse(stream, controller, spinner)

      // Update context history if request wasn't aborted
      if (!controller.signal.aborted) {
        const fullResponse = response.join('')

        // Add newline after LLM response to prevent prompt from overwriting
        if (fullResponse.trim()) {
          process.stdout.write('\n')
        }

        updateContext(stateManager, input, fullResponse)

        // Display context dots after response
        outputHandler.writeContextDots(stateManager)
      }
    } catch (error) {
      // Check if user cancelled request
      if (controller.signal.aborted) {
        // User pressed ESC - spinner already shows ☓
        return // Silent exit
      }

      // Real errors need to be shown to user
      const processedError = errorHandler.processError(error, {
        component: 'ChatHandler',
      })
      if (spinner.isActive()) {
        spinner.stop('error')
      }
      errorHandler.displayError(processedError)
    } finally {
      // Clear streamProcessor from StateManager
      const stateManager = app.stateManager
      stateManager.setStreamProcessor(null)

      // Cleanup: dispose spinner only
      // Processing state will be cleared by ApplicationLoop
      spinner.dispose()
    }
  }

  return {
    handle: handleChatRequest,
  }
}
