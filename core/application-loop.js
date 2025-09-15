import readline from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { color } from '../config/color.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from './error-system/index.js'
import { getAllAvailableCommands } from '../utils/autocomplete.js'
import { getStateManager } from './StateManager.js'
import { outputHandler } from './print/output.js'
import { createSpinner } from '../utils/spinner.js'

// Create completer function for system commands autocomplete
const createCompleter = () => {
  return (line) => {
    const commands = getAllAvailableCommands()
    const hits = commands.filter((cmd) => cmd.startsWith(line))
    // Show matches or all commands if no matches
    return [hits.length ? hits : [], line]
  }
}

export const createApplicationLoop = (app) => {
  // Get StateManager instance
  const stateManager = getStateManager()

  // State (functional closures instead of class properties)
  const state = {
    app,
    stateManager,
    rl: null,
    escHandlers: new Map(),
    currentEscHandler: null,
    handlerIdCounter: 0,
    screenWasCleared: false,
    keypressEnabled: false,
    isExiting: false,
    currentEscapeResolve: null,
    globalKeyPressHandler: null,
  }

  // Helper function to get router dynamically
  const getRouter = () => state.app.router

  // Readline config for pause/resume functionality
  const readlineConfig = {
    input: process.stdin,
    output: process.stdout,
    completer: createCompleter(),
  }

  const createReadlineInterface = () => {
    const rl = readline.createInterface(readlineConfig)

    // CRITICAL: Redirect readline SIGINT to our graceful handler instead of default AbortError
    rl.on('SIGINT', () => {
      handleInterrupt()
    })

    return rl
  }

  const pauseReadline = () => {
    if (state.rl) {
      state.rl.close()
      state.rl = null
    }
  }

  const resumeReadline = () => {
    if (!state.rl) {
      state.rl = createReadlineInterface()
    }
  }

  const setupEscapeKeyHandling = () => {
    // Setup keypress events for escape handling (compatible with readline)
    emitKeypressEvents(process.stdin)
    process.stdin.on('keypress', (str, key) => {
      if (key && key.name === 'escape') {
        handleEscapeKey()
      }
    })
  }

  const handleEscapeKey = () => {
    // If there's a specific handler registered, use it
    if (state.currentEscHandler) {
      state.currentEscHandler()
      return
    }

    // Default ESC behavior for AI requests
    const controller = state.stateManager.getCurrentRequestController()

    // Cancel AbortController (signal to provider)
    if (controller) {
      controller.abort()
    }

    // INSTANT escape through Promise.race - don't wait for provider!
    if (state.currentEscapeResolve) {
      state.currentEscapeResolve('CANCELLED')
    }

    // Clean up streaming state
    if (state.stateManager.isTypingResponse()) {
      state.stateManager.setTypingResponse(false)
      state.stateManager.setShouldReturnToPrompt(true)
    }

    // Show cursor
    process.stdout.write('\x1B[?25h')
  }

  const setupCleanupHandlers = () => {
    const cleanup = () => {
      // No raw mode to disable - using readline interface only
      process.stdin.removeAllListeners('keypress')
      process.stdout.write('\x1B[?25h')
      // Close readline interface
      if (state.rl) {
        state.rl.close()
      }
    }

    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        handleEscapeKey() // Use unified ESC handling
      }
    }

    // Store handler in state for later use
    state.globalKeyPressHandler = globalKeyPressHandler

    // SIGINT handling is now done via readline.on('SIGINT') in createReadlineInterface()

    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  const showInitializationSpinner = async (callback) => {
    const spinner = createSpinner('Loading AI providers...')
    spinner.start()

    try {
      // Execute callback
      await callback()

      // Show success
      spinner.stop('success')

      return spinner.getElapsed()
    } catch (error) {
      // Show failure
      spinner.stop('error')
      throw error
    }
  }

  // REMOVED: createSpinner() - using utils/spinner.js instead (DRY principle)

  const processUserInput = async (userInput) => {
    try {
      userInput = sanitizeString(userInput)

      if (userInput.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
        console.log(
          `${color.red}Error: Input too long (max ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)${color.reset}`,
        )
        return false
      }

      validateString(userInput, 'user input', true)
      return userInput
    } catch (error) {
      errorHandler.handleError(error, { context: 'input_validation' })
      return false
    }
  }

  const handleEmptyInput = async () => {
    const contextHistory = state.stateManager.getContextHistory()
    if (contextHistory.length) {
      state.stateManager.clearContext()
      outputHandler.writeWarning('Context history cleared')
    } else {
      await new Promise((resolve) => {
        setTimeout(() => {
          outputHandler.clearScreen()
          state.screenWasCleared = true
          resolve()
        }, APP_CONSTANTS.CLEAR_TIMEOUT)
      })
    }
  }

  const getUserPrompt = () => {
    const colorInput = color.green
    return state.screenWasCleared
      ? `${colorInput}> `
      : `
${colorInput}> `
  }

  const startMainLoop = async () => {
    logger.debug('🎯 Starting CLI main loop')

    // If readline was closed during initialization, recreate it
    if (!state.rl || state.rl.closed) {
      state.rl = createReadlineInterface()
    }

    // CRITICAL FIX: Enable escape key handling for AI requests
    enableKeypressEvents()

    while (true) {
      // Check if readline is still open
      if (!state.rl || state.rl.closed) {
        if (!state.isExiting) {
          logger.error(
            'Readline interface was closed unexpectedly, exiting main loop',
          )
        } else {
          logger.debug('Readline interface closed during planned shutdown')
        }
        break
      }

      const prompt = getUserPrompt()

      // Get user input using standard readline
      let userInput = await state.rl.question(prompt)
      // Reset color after user input to ensure LLM response is not green
      process.stdout.write(color.reset)
      userInput = (userInput || '').trim()

      // Reset screen cleared flag after prompt is shown
      state.screenWasCleared = false

      if (!userInput) {
        await handleEmptyInput()
        continue
      }

      try {
        const processedInput = await processUserInput(userInput)
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


  const enableKeypressEvents = () => {
    if (!state.keypressEnabled) {
      // Enable keypress events without raw mode to avoid readline conflicts
      emitKeypressEvents(process.stdin)
      process.stdin.on('keypress', state.globalKeyPressHandler)
      state.keypressEnabled = true
    }
  }




  const registerEscHandler = (handlerFunction, description = '') => {
    const handlerId = ++state.handlerIdCounter
    state.escHandlers.set(handlerId, {
      handler: handlerFunction,
      description: description,
      registeredAt: Date.now(),
    })

    // Set as current handler
    state.currentEscHandler = handlerFunction

    logger.debug(`ESC handler registered: ${handlerId} - ${description}`)
    return handlerId
  }

  const unregisterEscHandler = (handlerId) => {
    const handlerData = state.escHandlers.get(handlerId)
    if (handlerData) {
      state.escHandlers.delete(handlerId)

      // If this was the current handler, clear it
      if (state.currentEscHandler === handlerData.handler) {
        state.currentEscHandler = null
      }

      logger.debug(
        `ESC handler unregistered: ${handlerId} - ${handlerData.description}`,
      )
      return true
    }
    return false
  }

  const clearAllEscHandlers = () => {
    const count = state.escHandlers.size
    state.escHandlers.clear()
    state.currentEscHandler = null
    logger.debug(`All ESC handlers cleared (${count} handlers)`)
  }

  const getEscHandlers = () => {
    const handlers = []
    for (const [id, data] of state.escHandlers) {
      handlers.push({
        id: id,
        description: data.description,
        registeredAt: data.registeredAt,
        isCurrent: state.currentEscHandler === data.handler,
      })
    }
    return handlers
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
    if (state.rl && !state.rl.closed) {
      state.rl.close() // Unblocks rl.question()
    }
  }

  const cancelActiveOperations = async () => {
    // Clear all custom ESC handlers
    clearAllEscHandlers()

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

    // Remove event listeners
    process.stdin.removeAllListeners('keypress')
  }

  const finalCleanup = () => {
    // Show cursor
    outputHandler.showCursor()

    // Farewell message
    outputHandler.writeSuccess('Goodbye!')

    // Give 50ms for message output, then exit
    setTimeout(() => process.exit(0), 50)
  }

  // Forward declaration for applicationLoopInstance
  const applicationLoopInstance = {}

  // Initialize the ApplicationLoop and setup
  state.rl = createReadlineInterface()
  setupEscapeKeyHandling()
  setupCleanupHandlers()

  // Populate the instance object with all methods
  Object.assign(applicationLoopInstance, {
    // Core loop functionality
    startMainLoop,
    exitApp,

    // App context accessor (for system commands)
    get app() {
      return state.app
    },

    // Readline management
    pauseReadline,
    resumeReadline,

    // ESC handling system
    registerEscHandler,
    unregisterEscHandler,
    clearAllEscHandlers,
    getEscHandlers,

    // Keypress management
    enableKeypressEvents,


    // Spinner functionality (using utils/spinner.js)
    showInitializationSpinner,

    // UI interfaces for commands
    ui: {
      get readline() {
        return state.rl
      },
      exitApp: () => exitApp(),
      pauseReadline: () => pauseReadline(),
      resumeReadline: () => resumeReadline(),
    },
  })

  return applicationLoopInstance
}
