import { logger } from '../../../utils/logger.js'
import { outputHandler } from '../../print/index.js'
import { errorHandler } from '../../error-system/index.js'
import { createStreamCommandRunner } from '../stream-runner.js'

export const createModelExecutor = (stateManager) => {
  const runStreamCommand = createStreamCommandRunner({ stateManager })

  const executeModel = async (
    model,
    messages,
    coordinator,
    uiManager,
    controller,
  ) => {
    const startTime = Date.now()
    let isThisModelWinner = false
    const responseBuffer = []

    try {
      logger.debug(
        `ModelExecutor: Starting model ${coordinator.getModelKey(model)}`,
      )

      const { aborted } = await runStreamCommand({
        controller,
        messages,
        providerModel: model,
        useSpinner: false,
        onChunk: ({ content }) => {
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
        },
      })

      const timing = (Date.now() - startTime) / 1000
      const fullResponse = responseBuffer.join('')

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

      coordinator.completeModel(model, result)

      logger.debug(
        `ModelExecutor: Model ${coordinator.getModelKey(model)} failed - ${errorMessage}`,
      )

      return result
    }
  }

  const executeModelsRace = async (
    models,
    messages,
    coordinator,
    uiManager,
    controller,
  ) => {
    logger.debug(`ModelExecutor: Starting race with ${models.length} models`)

    const modelPromises = models.map((model) => {
      const promise = executeModel(
        model,
        messages,
        coordinator,
        uiManager,
        controller,
      )
      coordinator.registerModel(model, promise)
      return promise
    })

    const results = await Promise.all(modelPromises)

    await new Promise((resolve) => {
      if (coordinator.isAllCompleted()) {
        resolve()
      } else {
        coordinator.onAllCompleted(() => resolve())
      }
    })

    const successfulCount = results.filter((result) => result.success).length

    logger.debug(
      `ModelExecutor: Race completed - ${successfulCount}/${models.length} successful`,
    )

    return successfulCount
  }

  return {
    executeModelsRace,
  }
}
