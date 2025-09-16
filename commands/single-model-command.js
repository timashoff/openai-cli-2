import { logger } from '../utils/logger.js'
import { createStreamProcessor } from '../utils/stream-processor.js'
import { createSpinner } from '../utils/spinner.js'
import { errorHandler } from '../core/error-system/index.js'
import { outputHandler } from '../core/print/index.js'
import { prepareStreamingMessages } from '../utils/message-utils.js'
import { updateContext } from '../utils/context-utils.js'

export function createSingleModelCommand(app) {
  function extractProviderModel(modelEntry) {
    if (modelEntry.model) {
      return {
        provider: modelEntry.provider,
        model: modelEntry.model,
      }
    }
    return null
  }



  async function handleStreamResponse(
    stream,
    controller,
    spinner,
    providerModel,
  ) {
    const streamProcessor = createStreamProcessor()
    const response = []
    let firstChunk = true

    const chunkHandler = async (content) => {
      if (controller.signal.aborted) {
        return
      }

      // Stop spinner on first chunk and show model info
      if (firstChunk) {
        spinner.stop('success') // ✓ 1.2s

        // Display model header if using specific provider
        if (providerModel) {
          outputHandler.writeNewline()
          outputHandler.writeModel(providerModel)
        }

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
      // Zero Trust: Show safe message directly, don't re-throw
      outputHandler.writeError(processedError.userMessage)
      return [] // Continue gracefully
    }

    return response
  }


  async function handleSingleModelCommand(data) {
    try {
      logger.debug(
        'SingleModelCommand: Processing instruction command with single model',
      )

      // AbortSignal automatically managed via Event-Driven StateManager
      // (No manual outputHandler.setAbortSignal needed)

      // Extract specific provider and model if provided
      const providerModel = data.models.length
        ? extractProviderModel(data.models[0])
        : null

      // Execute chat request with prepared content and provider model
      return await processSingleModelRequest(data.content, providerModel)
    } catch (error) {
      errorHandler.handleError(error, { component: 'SingleModelCommand' })
      return [] // Error already handled and shown to user - don't re-throw
    }
  }

  async function processSingleModelRequest(content, providerModel = null) {
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
      const messages = prepareStreamingMessages(stateManager, content)

      // Create streaming request with abort signal - use StateManager directly
      const stream = await stateManager.createChatCompletion(messages, {
        stream: true,
        signal: controller.signal
      }, providerModel)

      // Process streaming response
      const response = await handleStreamResponse(
        stream,
        controller,
        spinner,
        providerModel,
      )

      // Update context history if request wasn't aborted
      if (!controller.signal.aborted) {
        const fullResponse = response.join('')

        // Add newline after LLM response to prevent prompt from overwriting
        if (fullResponse.trim()) {
          process.stdout.write('\n')
        }

        updateContext(stateManager, content, fullResponse)

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
        component: 'SingleModelCommand',
      })
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
    execute: handleSingleModelCommand,
  }
}
