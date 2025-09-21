import { logger } from '../../../utils/logger.js'
import { outputHandler } from '../../print/index.js'
import { errorHandler } from '../../error-system/index.js'
import { createResponseSessionFactory } from '../session.js'

export const createModelExecutor = (stateManager) => {
  const sessionFactory = createResponseSessionFactory({ stateManager })

  const executeModel = async (model, messages, coordinator, uiManager, controller) => {
    const startTime = Date.now()
    let isThisModelWinner = false
    const responseBuffer = []
    let session

    try {
      logger.debug(`ModelExecutor: Starting model ${coordinator.getModelKey(model)}`)

      session = sessionFactory.createSession({
        messages,
        controller,
        providerModel: model,
      })

      session.on('stream:chunk', ({ content }) => {
        if (!content || controller.signal.aborted) {
          return
        }

        responseBuffer.push(content)

        if (!isThisModelWinner && content.trim()) {
          isThisModelWinner = coordinator.setWinner(model)

          if (isThisModelWinner) {
            uiManager.displayWinnerHeader(model)
          }
        }

        if (isThisModelWinner) {
          outputHandler.writeStream(content)
        }
      })

      const { aborted } = await session.start()

      const timing = (Date.now() - startTime) / 1000
      const fullResponse = responseBuffer.join('')

      // Display timing for winner
      if (!aborted && isThisModelWinner) {
        uiManager.displayWinnerTiming(timing)
      }

      const result = aborted
        ? {
            model,
            timing,
            success: false,
            error: 'Request cancelled',
            isWinner: isThisModelWinner,
          }
        : {
            model,
            response: fullResponse,
            timing,
            success: true,
            isWinner: isThisModelWinner,
          }

      // Notify coordinator of completion
      coordinator.completeModel(model, result)

      logger.debug(
        `ModelExecutor: Model ${coordinator.getModelKey(model)} completed ${result.success ? 'successfully' : 'with cancellation'}`,
      )

      return result
    } catch (error) {
      const timing = (Date.now() - startTime) / 1000

      let errorMessage = 'Model request failed'
      if (error.message === 'AbortError' || error.name === 'AbortError') {
        errorMessage = 'Request cancelled'
      } else {
        const processedError = await errorHandler.processError(error, {
          component: 'ModelExecutor',
          model: coordinator.getModelKey(model),
        })

        if (processedError.userMessage) {
          errorMessage = processedError.userMessage
        }
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
    } finally {
      if (session) {
        session.dispose()
      }
    }
  }

  const executeModelsRace = async (models, messages, coordinator, uiManager, controller) => {
    logger.debug(`ModelExecutor: Starting race with ${models.length} models`)

    // Start all models in parallel - clean Promise approach
    const modelPromises = models.map(model => {
      const promise = executeModel(model, messages, coordinator, uiManager, controller)
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
    executeModelsRace
  }
}
