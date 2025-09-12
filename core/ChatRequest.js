/**
 * ChatRequest - Handles final chat request processing
 * Functional object (NO CLASSES per CLAUDE.md!)
 * Final step in Router → CommandHandler → ChatRequest architecture
 */
import { logger } from '../utils/logger.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { createSpinner } from '../utils/spinner.js'
import { errorHandler } from './error-system/index.js'
import { outputHandler } from './output-handler.js'

export function createChatRequest(app) {

  function extractProviderModel(modelEntry) {
    if (modelEntry.model) {
      return {
        provider: modelEntry.provider,
        model: modelEntry.model
      }
    }
    return null
  }

  async function processChatRequest(data) {
    try {
      logger.debug('ChatRequest: Processing final chat request')

      // Setup abort signal for outputHandler using app.stateManager
      const controller = app.stateManager.getCurrentRequestController()
      if (controller) {
        outputHandler.setAbortSignal(controller.signal)
      }

      // Extract specific provider and model if provided
      const providerModel = data.models.length ? extractProviderModel(data.models[0]) : null

      // Execute chat request with prepared content and provider model
      return await handleChatRequest(data.content, providerModel)

    } catch (error) {
      errorHandler.handleError(error, { component: 'ChatRequest' })
      throw error
    }
  }


  async function handleChatRequest(input, providerModel = null) {
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
      const contextHistory = stateManager.getContextHistory()
      const messages = contextHistory.map(({ role, content }) => ({ role, content }))
      messages.push({ role: 'user', content: input })

      // Create streaming request with abort signal - use StateManager directly
      const stream = await stateManager.createChatCompletion(messages, {
        stream: true,
        signal: controller.signal
      }, providerModel)

      // Simple streaming response processing
      const streamProcessor = new StreamProcessor(stateManager.getCurrentProviderKey())
      const response = []
      let firstChunk = true

      const chunkHandler = async (content) => {
        // Check for abort
        if (controller.signal.aborted) {
          return
        }

        // Stop spinner on first chunk and show model info
        if (firstChunk) {
          spinner.stop('success') // ✓ 1.2s

          // Display model header if using specific provider
          if (providerModel) {
            const providerName = providerModel.provider
            outputHandler.write(`\n${providerName} (${providerModel.model}):`)
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
        await streamProcessor.processStream(stream, controller.signal, chunkHandler)
      } catch (streamError) {
        // Handle stream-specific abort errors using unified handler
        const processedError = errorHandler.processError(streamError, { component: 'StreamProcessor' })
        if (!processedError.shouldDisplay) {
          return // Silent abort - no error message
        }
        throw streamError // Re-throw other errors
      }

      // Update context history if request wasn't aborted
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

    } catch (error) {
      // Check if user cancelled request
      if (controller.signal.aborted) {
        // User pressed ESC - spinner already shows ☓
        return  // Silent exit
      }

      // Real errors need to be shown to user
      const processedError = errorHandler.processError(error, { component: 'ChatRequest' })
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

  /**
   * Dispose ChatRequest resources
   */
  function dispose() {
    logger.info('ChatRequest disposed')
  }

  // Return functional object (NO CLASS!)
  return {
    processChatRequest,
    handleChatRequest,
    dispose
  }
}
