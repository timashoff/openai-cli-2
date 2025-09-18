import { createMultiModelCoordinator } from './coordinator.js'
import { createUIManager } from './ui-manager.js'
import { createModelExecutor } from './model-executor.js'
import { prepareStreamingMessages } from '../../utils/message-utils.js'
import { updateContext } from '../../utils/context-utils.js'
import { outputHandler } from '../../core/print/index.js'
import { logger } from '../../utils/logger.js'

export const createMultiModelCommand = () => {
  const executeModels = async (
    models,
    commandData,
    stateManager,
    controller,
  ) => {
    const coordinator = createMultiModelCoordinator()
    const uiManager = createUIManager()
    const modelExecutor = createModelExecutor(stateManager)

    // Track winner completion state
    let winnerHasCompleted = false

    // Setup event handlers for proper result display coordination
    coordinator.onDisplayResult((event) => {
      // Only display non-winner results (winner already shown via displayWinnerTiming)
      if (!event.result.isWinner) {
        uiManager.displayModelResult(event.result)

        // IMMEDIATELY update spinner after showing result
        if (winnerHasCompleted && !controller.signal.aborted) {
          const remainingCount = coordinator.getRemainingCount()
          if (remainingCount > 0) {
            uiManager.showRemainingSpinner(controller, remainingCount)
          } else {
            // No more models remaining - cleanup
            outputHandler.clearLine()
          }
        }
      }
    })

    // Setup spinner management after winner completion

    coordinator.onWinnerCompleted((event) => {
      winnerHasCompleted = true
      // After winner completes, start spinner for remaining models
      const remainingCount = coordinator.getRemainingCount()
      if (remainingCount > 0 && !controller.signal.aborted) {
        uiManager.showRemainingSpinner(controller, remainingCount)
      }
    })

    // Removed spinner logic from here - now handled synchronously in onDisplayResult

    coordinator.onAllCompleted(() => {
      // All models completed - cleanup
      outputHandler.clearLine()
    })

    // Prepare messages for streaming
    const messages = prepareStreamingMessages(stateManager, commandData.content)

    // Start initial spinner
    uiManager.startInitialSpinner(controller)

    let successfulCount = 0
    const successfulResults = []

    // Collect successful results as they complete
    coordinator.onModelCompleted((event) => {
      if (event.result.success && event.result.response) {
        successfulResults.push(event.result)
      }
    })

    try {
      // Execute models race - simple Promise.all approach that waits for all models
      successfulCount = await modelExecutor.executeModelsRace(
        models,
        messages,
        coordinator,
        uiManager,
        controller,
      )

      // Update context with successful responses
      if (successfulResults.length > 0 && !controller.signal.aborted) {
        const allResponses = successfulResults.map((r) => r.response)
        updateContext(stateManager, commandData.content, allResponses)
      }

      // Display final summary
      if (!controller.signal.aborted) {
        uiManager.displaySummary(successfulCount, models.length, stateManager)
      }

      return successfulCount
    } catch (error) {
      // Cleanup on error - no special handling needed for spinner
      throw error
    } finally {
      // Reset coordinator state for next use
      coordinator.resetState()
    }
  }

  return {
    execute: async (commandData, app) => {
      // Extract what we need from clean API parameters
      const models = commandData.models
      const stateManager = app.stateManager
      const controller = stateManager.getCurrentRequestController()

      if (!controller) {
        throw new Error('AbortController not available')
      }

      // Call internal function with proper parameters
      return await executeModels(models, commandData, stateManager, controller)
    },
  }
}
