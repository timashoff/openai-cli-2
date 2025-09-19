import { createMultiModelCoordinator } from './coordinator.js'
import { createUIManager } from './ui-manager.js'
import { createModelExecutor } from './model-executor.js'
import { prepareStreamingMessages } from '../../utils/message-utils.js'
import { updateContext } from '../../utils/context-utils.js'
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


    // Pure event-driven handlers - no logic duplication
    coordinator.onDisplayResult((event) => {
      // Only display non-winner results (winner already shown via displayWinnerTiming)
      if (!event.result.isWinner) {
        uiManager.displayModelResult(event.result)
      }
    })

    coordinator.onRemainingCountChanged((event) => {
      // Reactive spinner management based on remaining count
      if (event.remainingCount > 0) {
        uiManager.showRemainingSpinner(controller, event.remainingCount)
      }
    })

    coordinator.onAllCompleted(() => {
      uiManager.cleanup()
    })

    // Single abort handling - reactive approach
    controller.signal.addEventListener('abort', () => {
      uiManager.cleanup()
      coordinator.resetState()
    }, { once: true })

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
      if (successfulResults.length > 0) {
        const allResponses = successfulResults.map((r) => r.response)
        updateContext(stateManager, commandData.content, allResponses)
      }

      // Display final summary
      uiManager.displaySummary(successfulCount, models.length, stateManager)

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
