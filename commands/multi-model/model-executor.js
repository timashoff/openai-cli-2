import { createStreamProcessor } from '../../utils/stream-processor.js'
import { logger } from '../../utils/logger.js'
import { outputHandler } from '../../core/print/index.js'

export const createModelExecutor = (stateManager) => {
  const executeModel = async (model, messages, coordinator, uiManager, signal) => {
    const startTime = Date.now()
    let isThisModelWinner = false

    try {
      logger.debug(`ModelExecutor: Starting model ${coordinator.getModelKey(model)}`)

      // Create streaming request
      const stream = await stateManager.createChatCompletion(
        messages,
        {
          stream: true,
          signal,
        },
        model,
      )

      const streamProcessor = createStreamProcessor()
      const responseBuffer = []

      // Winner detection happens HERE in chunkHandler
      const chunkHandler = async (content) => {
        if (signal.aborted) return

        responseBuffer.push(content)

        // First meaningful chunk makes this model the winner - simplified check
        if (!coordinator.winnerModel && content.trim()) {
          isThisModelWinner = coordinator.setWinner(model)

          if (isThisModelWinner) {
            uiManager.displayWinnerHeader(model)
          }
        }

        // Real-time streaming ONLY for winner
        if (isThisModelWinner && content) {
          outputHandler.writeStream(content)
        }
      }

      // Process stream
      await streamProcessor.processStream(
        stream,
        signal,
        chunkHandler,
      )

      const timing = (Date.now() - startTime) / 1000
      const fullResponse = responseBuffer.join('')

      // Display timing for winner
      if (isThisModelWinner) {
        uiManager.displayWinnerTiming(timing)
      }

      const result = {
        model,
        response: fullResponse,
        timing,
        success: true,
        isWinner: isThisModelWinner,
      }

      // Notify coordinator of completion
      coordinator.completeModel(model, result)

      logger.debug(`ModelExecutor: Model ${coordinator.getModelKey(model)} completed successfully`)

      return result

    } catch (error) {
      const timing = (Date.now() - startTime) / 1000

      let errorMessage = 'Model request failed'
      if (error.message === 'AbortError' || error.name === 'AbortError') {
        errorMessage = 'Request cancelled'
      }

      const result = {
        model,
        timing,
        success: false,
        error: errorMessage,
        isWinner: isThisModelWinner,
      }

      // Notify coordinator of completion even on error
      coordinator.completeModel(model, result)

      logger.debug(`ModelExecutor: Model ${coordinator.getModelKey(model)} failed - ${errorMessage}`)

      return result
    }
  }

  const executeModelsRace = async (models, messages, coordinator, uiManager, controller) => {
    logger.debug(`ModelExecutor: Starting race with ${models.length} models`)

    // Start all models in parallel - clean Promise approach
    const modelPromises = models.map(model => {
      const promise = executeModel(model, messages, coordinator, uiManager, controller.signal)
      coordinator.registerModel(model, promise)
      return promise
    })

    // Wait for all models to complete - no generators needed!
    // Using Promise.all since executeModel never throws (returns error objects)
    const results = await Promise.all(modelPromises)

    // Wait for coordinator to finish all event processing
    await new Promise((resolve) => {
      if (coordinator.isAllCompleted()) {
        resolve()
      } else {
        coordinator.onAllCompleted(() => resolve())
      }
    })

    // Count successful models - simple filter
    const successfulCount = results.filter(result => result.success).length

    logger.debug(`ModelExecutor: Race completed - ${successfulCount}/${models.length} successful`)

    return successfulCount
  }

  return {
    executeModel,
    executeModelsRace
  }
}