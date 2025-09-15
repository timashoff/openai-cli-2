import { outputHandler } from '../print/output.js'
import { logger } from '../../utils/logger.js'

export const createLifecycleManager = (state) => {
  // Shared cleanup function to avoid DRY violations
  const cleanup = () => {
    // No raw mode to disable - using readline interface only
    process.stdin.removeAllListeners('keypress')
    outputHandler.showCursor()
    // Close readline interface
    if (state.readlineManager) {
      state.readlineManager.pauseReadline()
    }
  }

  const setupCleanupHandlers = () => {

    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        state.keypressHandler.handleEscapeKey() // Use unified ESC handling from keypress handler
      }
    }

    // Store handler in state for later use
    state.globalKeyPressHandler = globalKeyPressHandler

    // SIGINT handling is now done via readline.on('SIGINT') in createReadlineInterface()

    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  const handleInterrupt = async () => {
    // Check if we have active requests that need graceful cancellation
    const controller = state.stateManager.getCurrentRequestController()

    if (controller && state.stateManager.isProcessingRequest()) {
      // There's an active request - cancel it gracefully like ESC does
      controller.abort()

      // Use outputHandler with abort signal like ESC does
      outputHandler.setAbortSignal(controller.signal)

      // Clean up streaming state
      if (state.stateManager.isTypingResponse()) {
        state.stateManager.setTypingResponse(false)
        state.stateManager.setShouldReturnToPrompt(true)
      }

      // Give brief moment for cancellation to process
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    // Now proceed with graceful exit
    await exitApp()
  }

  const exitApp = async () => {
    // Prevent duplicate calls
    if (state.isExiting) return
    state.isExiting = true

    outputHandler.writeInfo('Shutting down...')

    // PHASE 1: Immediately stop user input
    stopUserInput()

    // PHASE 2: Cancel active operations
    await cancelActiveOperations()

    // PHASE 3: Final cleanup and exit
    finalCleanup()
  }

  const stopUserInput = () => {
    if (state.readlineManager && state.readlineManager.getReadlineInterface() && !state.readlineManager.getReadlineInterface().closed) {
      state.readlineManager.getReadlineInterface().close() // Unblocks rl.question()
    }
  }

  const cancelActiveOperations = async () => {
    // Clear all custom ESC handlers
    state.keypressHandler.clearAllEscHandlers()

    // Cancel active LLM requests (save tokens)
    const controller = state.stateManager.getCurrentRequestController()
    if (controller) {
      controller.abort()
      outputHandler.writeWarning('Cancelled pending AI request')
      // Give time for abort signal to be sent
      await new Promise((r) => setTimeout(r, 100))
    }

    // Clear timers
    const spinnerInterval = state.stateManager.getSpinnerInterval()
    if (spinnerInterval) {
      clearInterval(spinnerInterval)
      state.stateManager.setSpinnerInterval(null)
    }

    // Use shared cleanup function to avoid code duplication
    cleanup()
  }

  const finalCleanup = () => {
    // Show cursor already done in cleanup() function

    // Farewell message
    outputHandler.writeSuccess('Goodbye!')

    // Give 50ms for message output, then exit
    setTimeout(() => process.exit(0), 50)
  }


  return {
    setupCleanupHandlers,
    handleInterrupt,
    exitApp,
    stopUserInput,
    cancelActiveOperations,
    finalCleanup,
  }
}