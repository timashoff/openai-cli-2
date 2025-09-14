import readline from 'node:readline/promises'
import * as readlineSync from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
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

/**
 * Factory function to create ApplicationLoop instance (FUNCTIONAL PARADIGM)
 */
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

  /**
   * Create readline interface with proper SIGINT handling (DRY principle)
   */
  const createReadlineInterface = () => {
    const rl = readline.createInterface(readlineConfig)

    // CRITICAL: Redirect readline SIGINT to our graceful handler instead of default AbortError
    rl.on('SIGINT', () => {
      handleInterrupt()
    })

    return rl
  }

  /**
   * Temporarily pause readline interface for raw mode menus
   */
  const pauseReadline = () => {
    if (state.rl) {
      state.rl.close()
      state.rl = null
    }
  }

  /**
   * Resume readline interface after raw mode menus
   */
  const resumeReadline = () => {
    if (!state.rl) {
      state.rl = createReadlineInterface()
    }
  }

  /**
   * Setup escape key handling through stdin data events (without raw mode)
   */
  const setupEscapeKeyHandling = () => {
    // Setup keypress events for escape handling (compatible with readline)
    readlineSync.emitKeypressEvents(process.stdin)
    process.stdin.on('keypress', (str, key) => {
      if (key && key.name === 'escape') {
        handleEscapeKey()
      }
    })
  }

  /**
   * Handle escape key press - uses dynamic handler system
   */
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

  /**
   * Setup global cleanup handlers (extracted from original)
   */
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

  /**
   * Show initialization spinner using utils/spinner.js
   */
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

  /**
   * Process user input with validation (extracted from original)
   */
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

  /**
   * Handle empty input logic (extracted from original)
   */
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

  /**
   * Get user prompt based on screen state (extracted from original)
   */
  const getUserPrompt = () => {
    const colorInput = color.green
    return state.screenWasCleared
      ? `${colorInput}> `
      : `
${colorInput}> `
  }

  /**
   * Main interaction loop (extracted from original)
   */
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

  /**
   * Set request processing state
   */
  const setProcessingRequest = (
    value,
    controller = null,
    streamProcessor = null,
  ) => {
    // Use StateManager for state management
    state.stateManager.setProcessingRequest(value, controller)
    if (streamProcessor) {
      state.stateManager.setStreamProcessor(streamProcessor)
    }

    // Enable/disable keypress events for escape handling
    if (value) {
      enableKeypressEvents()
    } else {
      // Keep keypress events enabled for menu interactions
      // Only disable when explicitly needed
    }
  }

  /**
   * Enable keypress events for escape handling (selective activation)
   */
  const enableKeypressEvents = () => {
    if (!state.keypressEnabled) {
      // Enable keypress events without raw mode to avoid readline conflicts
      readlineSync.emitKeypressEvents(process.stdin)
      process.stdin.on('keypress', state.globalKeyPressHandler)
      state.keypressEnabled = true
    }
  }

  /**
   * Disable keypress events
   */
  const disableKeypressEvents = () => {
    if (state.keypressEnabled) {
      process.stdin.removeListener('keypress', state.globalKeyPressHandler)
      state.keypressEnabled = false
    }
  }

  /**
   * Start interactive session (e.g., command menus) - enables ESC handling
   */
  const startInteractiveSession = () => {
    enableKeypressEvents()
  }

  /**
   * End interactive session - keeps keypress for main loop
   */
  const endInteractiveSession = () => {
    // Keep keypress events enabled for main application ESC handling
    // Don't disable unless explicitly needed
  }

  /**
   * Register a custom ESC handler - returns handler ID for unregistering
   */
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

  /**
   * Unregister ESC handler by ID
   */
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

  /**
   * Clear all custom ESC handlers - revert to default behavior
   */
  const clearAllEscHandlers = () => {
    const count = state.escHandlers.size
    state.escHandlers.clear()
    state.currentEscHandler = null
    logger.debug(`All ESC handlers cleared (${count} handlers)`)
  }

  /**
   * Get list of registered ESC handlers (for debugging)
   */
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

  /**
   * Set typing response state
   */
  const setTypingResponse = (value) => {
    // Use StateManager for state management
    state.stateManager.setTypingResponse(value)
  }

  /**
   * Set spinner interval
   */
  const setSpinnerInterval = (interval) => {
    // Use StateManager for state management
    state.stateManager.setSpinnerInterval(interval)
  }

  /**
   * Set return to prompt flag
   */
  const setShouldReturnToPrompt = (value) => {
    // Use StateManager for state management
    state.stateManager.setShouldReturnToPrompt(value)
  }

  /**
   * Get current CLI state
   */
  const getState = () => {
    const operationState = state.stateManager.getOperationState()
    return {
      isProcessingRequest: operationState.isProcessingRequest,
      isTypingResponse: operationState.isTypingResponse,
      shouldReturnToPrompt: operationState.shouldReturnToPrompt,
      screenWasCleared: state.screenWasCleared,
    }
  }

  // REMOVED: Theatrical methods (writeOutput, writeWarning, writeInfo, writeError, showContextHistory)
  // These methods were not used anywhere in the codebase - PURE THEATER!
  // Use errorHandler.handleError() and outputHandler.* methods instead

  /**
   * Handle Ctrl+C interrupt gracefully (same as ESC + exit)
   */
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

  /**
   * Graceful application exit with resource cleanup
   */
  const exitApp = async () => {
    // Предотвращаем повторный вызов
    if (state.isExiting) return
    state.isExiting = true

    outputHandler.writeInfo('Shutting down...')

    // ФАЗА 1: Немедленно останавливаем пользовательский ввод
    stopUserInput()

    // ФАЗА 2: Отменяем активные операции
    await cancelActiveOperations()

    // ФАЗА 3: Финальная очистка и выход
    finalCleanup()
  }

  /**
   * Stop user input immediately
   */
  const stopUserInput = () => {
    if (state.rl && !state.rl.closed) {
      state.rl.close() // Разблокирует rl.question()
    }
  }

  /**
   * Cancel active operations and cleanup resources
   */
  const cancelActiveOperations = async () => {
    // Clear all custom ESC handlers
    clearAllEscHandlers()

    // Отменяем активные LLM запросы (экономия токенов)
    const controller = state.stateManager.getCurrentRequestController()
    if (controller) {
      controller.abort()
      outputHandler.writeWarning('Cancelled pending AI request')
      // Даем время на отправку abort сигнала
      await new Promise((r) => setTimeout(r, 100))
    }

    // Очищаем таймеры
    const spinnerInterval = state.stateManager.getSpinnerInterval()
    if (spinnerInterval) {
      clearInterval(spinnerInterval)
      state.stateManager.setSpinnerInterval(null)
    }

    // Отключаем слушателей событий
    process.stdin.removeAllListeners('keypress')
  }

  /**
   * Final cleanup and process exit
   */
  const finalCleanup = () => {
    // Показываем курсор
    outputHandler.showCursor()

    // Прощальное сообщение
    outputHandler.writeSuccess('Goodbye!')

    // Даем 50ms на вывод сообщения, затем выход
    setTimeout(() => process.exit(0), 50)
  }

  // REMOVED: processStreamingResponse() - DUPLICATES utils/stream-processor.js!
  // Use createStreamProcessor() from utils/stream-processor.js instead

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
    disableKeypressEvents,
    startInteractiveSession,
    endInteractiveSession,

    // Processing state
    setProcessingRequest,
    setTypingResponse,
    setSpinnerInterval,
    setShouldReturnToPrompt,
    getState,

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
