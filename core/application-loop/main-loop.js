import { logger } from '../../utils/logger.js'
import { errorHandler } from '../error-system/index.js'
import { color } from '../../config/color.js'

export const createMainLoop = (state, applicationLoopInstance) => {
  // Helper function to get router dynamically
  const getRouter = () => state.app.router

  const startMainLoop = async () => {
    logger.debug('🎯 Starting CLI main loop')

    // If readline was closed during initialization, recreate it
    const rl = state.readlineManager.getReadlineInterface()
    if (!rl || rl.closed) {
      state.readlineManager.resumeReadline()
    }

    // CRITICAL FIX: Enable escape key handling for AI requests
    state.keypressHandler.enableKeypressEvents()

    while (true) {
      // Check if readline is still open
      const currentRl = state.readlineManager.getReadlineInterface()
      if (!currentRl || currentRl.closed) {
        if (!state.isExiting) {
          logger.error(
            'Readline interface was closed unexpectedly, exiting main loop',
          )
        } else {
          logger.debug('Readline interface closed during planned shutdown')
        }
        break
      }

      const prompt = state.inputProcessor.getUserPrompt(state.screenWasCleared)

      // Get user input using standard readline
      let userInput = await state.readlineManager.getReadlineInterface().question(prompt)
      // Reset color after user input to ensure LLM response is not green
      process.stdout.write(color.reset)
      userInput = (userInput || '').trim()

      // Reset screen cleared flag after prompt is shown
      state.screenWasCleared = false

      if (!userInput) {
        await state.inputProcessor.handleEmptyInput(state)
        continue
      }

      try {
        const processedInput = await state.inputProcessor.processUserInput(userInput)
        if (!processedInput) {
          continue
        }

        // CRITICAL FIX: Create AbortController and set processing state BEFORE execution
        const controller = new AbortController()
        state.stateManager.setProcessingRequest(true, controller)

        // Create escape promise for instant cancellation
        let escapeResolve = null
        const escapePromise = new Promise((resolve) => {
          escapeResolve = resolve
        })

        // Store escape resolve for ESC handler
        state.currentEscapeResolve = escapeResolve

        // Promise.race: request execution VS instant ESC
        const result = await Promise.race([
          getRouter().routeAndProcess(processedInput, applicationLoopInstance), // May take 0.8-1.0s
          escapePromise, // Completes instantly on ESC
        ])

        // Clear escape resolve
        state.currentEscapeResolve = null

        if (result === 'CANCELLED') {
          // ESC pressed - show new prompt immediately, ignore provider result
          continue
        }
      } catch (error) {
        // Handle other errors gracefully (abort is handled by Promise.race above)
        try {
          // Suppress errors during shutdown to avoid crash messages during Ctrl+C
          if (state.isExiting) {
            // During shutdown, silently ignore AbortErrors and other cancellation errors
            if (
              error.message === 'AbortError' ||
              error.name === 'AbortError' ||
              error.message.includes('aborted') ||
              error.message.includes('cancelled')
            ) {
              continue // Exit silently during shutdown
            }
          }

          // Clean up state after error to prevent corruption
          try {
            state.app.stateManager.clearAllOperations()
          } catch (cleanupError) {
            // Ignore cleanup errors during shutdown
          }

          errorHandler.handleError(error, { context: 'user_input' })

          // If it's a user input error, continue the loop for recovery
          if (
            error.isUserInputError ||
            error.requiresPrompt ||
            (error.message &&
              error.message.includes('requires additional input'))
          ) {
            continue // Continue to next prompt
          }
        } catch (handlerError) {
          // If error handler itself fails, show basic message and continue
          // But not during shutdown
          if (!state.isExiting) {
            console.log(
              `${color.red}An error occurred. Please try again.${color.reset}`,
            )
          }
          continue
        }
      } finally {
        // CRITICAL FIX: Always clear processing state after command execution/error
        state.stateManager.setProcessingRequest(false)
        state.stateManager.clearRequestController() // Explicitly clear controller when done
      }
    }
  }

  return {
    startMainLoop,
  }
}