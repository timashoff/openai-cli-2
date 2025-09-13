/**
 * ApplicationLoop - Main application loop, UI layer and ESC handling
 * Handles terminal setup, keypress events, main loop, and user input processing
 */
import readline from 'node:readline/promises'
import * as readlineSync from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getElapsedTime } from '../utils/elapsed-time.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from './error-system/index.js'
import { getAllAvailableCommands } from '../utils/autocomplete.js'
import { getStateManager } from './StateManager.js'
import { outputHandler } from './output-handler.js'

// Create completer function for system commands autocomplete
function completer(line) {
  const commands = getAllAvailableCommands()
  const hits = commands.filter((cmd) => cmd.startsWith(line))
  // Show matches or all commands if no matches
  return [hits.length ? hits : [], line]
}

export class ApplicationLoop {
  constructor(app) {
    this.app = app
    
    // Get StateManager instance
    this.stateManager = getStateManager()
    
    // Store readline config for pause/resume functionality
    this.readlineConfig = {
      input: process.stdin, 
      output: process.stdout,
      completer // Restored after removing conflicting readline from utils/index.js
    }
    
    // Create own readline interface  
    this.rl = this.createReadlineInterface()
    
    // Dynamic ESC handler system
    this.escHandlers = new Map() // id -> handler function
    this.currentEscHandler = null // Currently active handler
    this.handlerIdCounter = 0 // Unique handler IDs
    
    // Setup escape key handling through data events (not raw mode)
    this.setupEscapeKeyHandling()
    
    // CLI state (non-StateManager managed)
    this.screenWasCleared = false
    this.keypressEnabled = false
    this.isExiting = false // Предотвращение двойного exit
    
    this.setupCleanupHandlers()
  }

  /**
   * Create readline interface with proper SIGINT handling (DRY principle)
   */
  createReadlineInterface() {
    const rl = readline.createInterface(this.readlineConfig)
    
    // CRITICAL: Redirect readline SIGINT to our graceful handler instead of default AbortError
    rl.on('SIGINT', () => {
      this.handleInterrupt()
    })
    
    return rl
  }

  /**
   * Temporarily pause readline interface for raw mode menus
   */
  pauseReadline() {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }

  /**
   * Resume readline interface after raw mode menus
   */
  resumeReadline() {
    if (!this.rl) {
      this.rl = this.createReadlineInterface()
    }
  }

  /**
   * Setup escape key handling through stdin data events (without raw mode)
   */
  setupEscapeKeyHandling() {
    // Setup keypress events for escape handling (compatible with readline)
    readlineSync.emitKeypressEvents(process.stdin)
    process.stdin.on('keypress', (str, key) => {
      if (key && key.name === 'escape') {
        this.handleEscapeKey()
      }
    })
  }

  /**
   * Handle escape key press - uses dynamic handler system
   */
  handleEscapeKey() {
    // If there's a specific handler registered, use it
    if (this.currentEscHandler) {
      this.currentEscHandler()
      return
    }
    
    // Default ESC behavior for AI requests
    const controller = this.stateManager.getCurrentRequestController()
    
    // Cancel AbortController (signal to provider)
    if (controller) {
      controller.abort()
    }
    
    // INSTANT escape through Promise.race - don't wait for provider!
    if (this.currentEscapeResolve) {
      this.currentEscapeResolve('CANCELLED')
    }
    
    // Clean up streaming state
    if (this.stateManager.isTypingResponse()) {
      this.stateManager.setTypingResponse(false)
      this.stateManager.setShouldReturnToPrompt(true)
    }
    
    // Show cursor
    process.stdout.write('\x1B[?25h')
  }

  /**
   * Setup global cleanup handlers (extracted from original)
   */
  setupCleanupHandlers() {
    const cleanup = () => {
      // No raw mode to disable - using readline interface only
      process.stdin.removeAllListeners('keypress')
      process.stdout.write('\x1B[?25h')
      // Close readline interface
      if (this.rl) {
        this.rl.close()
      }
    }
    
    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        this.handleEscapeKey() // Use unified ESC handling
      }
    }
    
    // Only enable keypress events when needed for escape handling
    // Don't enable globally as it conflicts with readline
    this.globalKeyPressHandler = globalKeyPressHandler
    
    // SIGINT handling is now done via readline.on('SIGINT') in createReadlineInterface()
    
    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  /**
   * Show initialization spinner (extracted from original)
   */
  async showInitializationSpinner(callback) {
    let spinnerIndex = 0
    let spinnerInterval = null
    const initStartTime = Date.now()
    
    try {
      // Show loading spinner
      process.stdout.write('\x1B[?25l') // Hide cursor
      spinnerInterval = setInterval(() => {
        outputHandler.clearLine()
        const elapsedTime = getElapsedTime(initStartTime)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[spinnerIndex++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s Loading AI providers...${color.reset}`
        )
      }, APP_CONSTANTS.SPINNER_INTERVAL)
      
      // Execute callback
      await callback()
      
      // Clear spinner and show cursor
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        spinnerInterval = null
      }
      outputHandler.clearLine()
      const finalTime = getElapsedTime(initStartTime)
      process.stdout.write(`✓ ${finalTime}s\n`)
      process.stdout.write('\x1B[?25h') // Show cursor
      
      return finalTime
      
    } catch (error) {
      // Clear spinner on error
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        spinnerInterval = null
      }
      outputHandler.clearLine()
      process.stdout.write('\x1B[?25h') // Show cursor
      throw error
    }
  }

  /**
   * Create a reusable spinner instance
   */
  createSpinner(message) {
    let spinnerIndex = 0
    let spinnerInterval = null
    const startTime = Date.now()
    let isActive = false
    
    const spinner = {
      get elapsedTime() {
        return getElapsedTime(startTime)
      },
      
      start() {
        if (isActive) return
        isActive = true
        
        // Show loading spinner
        process.stdout.write('\x1B[?25l') // Hide cursor
        spinnerInterval = setInterval(() => {
          outputHandler.clearLine()
          const elapsedTime = this.elapsedTime
          process.stdout.write(
            `${color.reset}${UI_SYMBOLS.SPINNER[spinnerIndex++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s ${message}${color.reset}`
          )
        }, APP_CONSTANTS.SPINNER_INTERVAL)
      },
      
      stop() {
        if (!isActive) return
        isActive = false
        
        if (spinnerInterval) {
          clearInterval(spinnerInterval)
          spinnerInterval = null
        }
        outputHandler.clearLine()
        process.stdout.write('\x1B[?25h') // Show cursor
      },
      
      succeed(successMessage = null) {
        this.stop()
        const finalTime = this.elapsedTime
        const msg = successMessage || `✓ ${finalTime}s`
        process.stdout.write(`${msg}\n`)
      },
      
      fail(errorMessage = null) {
        this.stop()
        const finalTime = this.elapsedTime
        const msg = errorMessage || `✗ ${finalTime}s`
        process.stdout.write(`${color.red}${msg}${color.reset}\n`)
      }
    }
    
    // Auto-start spinner
    spinner.start()
    
    return spinner
  }

  /**
   * Process user input with validation (extracted from original)
   */
  async processUserInput(userInput) {
    try {
      userInput = sanitizeString(userInput)
      
      if (userInput.length > APP_CONSTANTS.MAX_INPUT_LENGTH) {
        console.log(`${color.red}Error: Input too long (max ${APP_CONSTANTS.MAX_INPUT_LENGTH} characters)${color.reset}`)
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
  async handleEmptyInput() {
    const contextHistory = this.stateManager.getContextHistory()
    if (contextHistory.length) {
      this.stateManager.clearContext()
      outputHandler.writeWarning('Context history cleared')
    } else {
      await new Promise(resolve => {
        setTimeout(() => {
          outputHandler.clearScreen()
          this.screenWasCleared = true
          resolve()
        }, APP_CONSTANTS.CLEAR_TIMEOUT)
      })
    }
  }

  /**
   * Get user prompt based on screen state (extracted from original)
   */
  getUserPrompt() {
    const colorInput = color.green
    return this.screenWasCleared ? `${colorInput}> ` : `
${colorInput}> `
  }

  /**
   * Main interaction loop (extracted from original)
   */
  async startMainLoop() {
    logger.debug('🎯 Starting CLI main loop')
    
    // If readline was closed during initialization, recreate it
    if (!this.rl || this.rl.closed) {
      this.rl = this.createReadlineInterface()
    }
    
    // CRITICAL FIX: Enable escape key handling for AI requests
    this.enableKeypressEvents()
    
    while (true) {
      // Check if readline is still open
      if (!this.rl || this.rl.closed) {
        if (!this.isExiting) {
          logger.error('Readline interface was closed unexpectedly, exiting main loop')
        } else {
          logger.debug('Readline interface closed during planned shutdown')
        }
        break
      }
      
      const prompt = this.getUserPrompt()
      
      
      // Get user input using standard readline
      let userInput = await this.rl.question(prompt)
      // Reset color after user input to ensure LLM response is not green
      process.stdout.write(color.reset)
      userInput = (userInput || '').trim()
      
      
      // Reset screen cleared flag after prompt is shown
      this.screenWasCleared = false

      if (!userInput) {
        await this.handleEmptyInput()
        continue
      }

      try {
        const processedInput = await this.processUserInput(userInput)
        if (!processedInput) {
          continue
        }
        
        // CRITICAL FIX: Create AbortController and set processing state BEFORE execution
        const controller = new AbortController()
        this.stateManager.setProcessingRequest(true, controller)
        
        // Create escape promise for instant cancellation
        let escapeResolve = null
        const escapePromise = new Promise(resolve => {
          escapeResolve = resolve
        })
        
        // Store escape resolve for ESC handler
        this.currentEscapeResolve = escapeResolve
        
        // Promise.race: request execution VS instant ESC
        const result = await Promise.race([
          this.app.router.routeAndProcess(processedInput, this),  // May take 0.8-1.0s
          escapePromise                                           // Completes instantly on ESC
        ])
        
        // Clear escape resolve
        this.currentEscapeResolve = null
        
        if (result === 'CANCELLED') {
          // ESC pressed - show new prompt immediately, ignore provider result
          continue
        }
        
      } catch (error) {
        // Handle other errors gracefully (abort is handled by Promise.race above)
        try {
          // Suppress errors during shutdown to avoid crash messages during Ctrl+C
          if (this.isExiting) {
            // During shutdown, silently ignore AbortErrors and other cancellation errors
            if (error.message === 'AbortError' || error.name === 'AbortError' || 
                error.message.includes('aborted') || error.message.includes('cancelled')) {
              continue // Exit silently during shutdown
            }
          }
          
          // Clean up state after error to prevent corruption  
          try {
            this.app.stateManager.clearAllOperations()
          } catch (cleanupError) {
            // Ignore cleanup errors during shutdown
          }
          
          errorHandler.handleError(error, { context: 'user_input' })
          
          // If it's a user input error, continue the loop for recovery
          if (error.isUserInputError || error.requiresPrompt || 
              (error.message && error.message.includes('requires additional input'))) {
            continue // Continue to next prompt
          }
        } catch (handlerError) {
          // If error handler itself fails, show basic message and continue
          // But not during shutdown
          if (!this.isExiting) {
            console.log(`${color.red}An error occurred. Please try again.${color.reset}`)
          }
          continue
        }
      } finally {
        // CRITICAL FIX: Always clear processing state after command execution/error
        this.stateManager.setProcessingRequest(false)
        this.stateManager.clearRequestController() // Explicitly clear controller when done
      }
    }
  }

  /**
   * Set request processing state
   */
  setProcessingRequest(value, controller = null, streamProcessor = null) {
    // Use StateManager for state management
    this.stateManager.setProcessingRequest(value, controller)
    if (streamProcessor) {
      this.stateManager.setStreamProcessor(streamProcessor)
    }
    
    
    // Enable/disable keypress events for escape handling
    if (value) {
      this.enableKeypressEvents()
    } else {
      // Keep keypress events enabled for menu interactions
      // Only disable when explicitly needed
    }
  }

  /**
   * Enable keypress events for escape handling (selective activation)
   */
  enableKeypressEvents() {
    if (!this.keypressEnabled) {
      // Enable keypress events without raw mode to avoid readline conflicts
      readlineSync.emitKeypressEvents(process.stdin)
      process.stdin.on('keypress', this.globalKeyPressHandler)
      this.keypressEnabled = true
    }
  }

  /**
   * Disable keypress events
   */
  disableKeypressEvents() {
    if (this.keypressEnabled) {
      process.stdin.removeListener('keypress', this.globalKeyPressHandler)
      this.keypressEnabled = false
    }
  }

  /**
   * Start interactive session (e.g., command menus) - enables ESC handling
   */
  startInteractiveSession() {
    this.enableKeypressEvents()
  }

  /**
   * End interactive session - keeps keypress for main loop
   */
  endInteractiveSession() {
    // Keep keypress events enabled for main application ESC handling
    // Don't disable unless explicitly needed
  }

  /**
   * Register a custom ESC handler - returns handler ID for unregistering
   */
  registerEscHandler(handlerFunction, description = '') {
    const handlerId = ++this.handlerIdCounter
    this.escHandlers.set(handlerId, {
      handler: handlerFunction,
      description: description,
      registeredAt: Date.now()
    })
    
    // Set as current handler
    this.currentEscHandler = handlerFunction
    
    logger.debug(`ESC handler registered: ${handlerId} - ${description}`)
    return handlerId
  }

  /**
   * Unregister ESC handler by ID
   */
  unregisterEscHandler(handlerId) {
    const handlerData = this.escHandlers.get(handlerId)
    if (handlerData) {
      this.escHandlers.delete(handlerId)
      
      // If this was the current handler, clear it
      if (this.currentEscHandler === handlerData.handler) {
        this.currentEscHandler = null
      }
      
      logger.debug(`ESC handler unregistered: ${handlerId} - ${handlerData.description}`)
      return true
    }
    return false
  }

  /**
   * Clear all custom ESC handlers - revert to default behavior
   */
  clearAllEscHandlers() {
    const count = this.escHandlers.size
    this.escHandlers.clear()
    this.currentEscHandler = null
    logger.debug(`All ESC handlers cleared (${count} handlers)`)
  }

  /**
   * Get list of registered ESC handlers (for debugging)
   */
  getEscHandlers() {
    const handlers = []
    for (const [id, data] of this.escHandlers) {
      handlers.push({
        id: id,
        description: data.description,
        registeredAt: data.registeredAt,
        isCurrent: this.currentEscHandler === data.handler
      })
    }
    return handlers
  }

  /**
   * Set typing response state
   */
  setTypingResponse(value) {
    // Use StateManager for state management
    this.stateManager.setTypingResponse(value)
    
  }

  /**
   * Set spinner interval
   */
  setSpinnerInterval(interval) {
    // Use StateManager for state management
    this.stateManager.setSpinnerInterval(interval)
    
  }

  /**
   * Set return to prompt flag
   */
  setShouldReturnToPrompt(value) {
    // Use StateManager for state management
    this.stateManager.setShouldReturnToPrompt(value)
  }

  /**
   * Get current CLI state
   */
  getState() {
    const operationState = this.stateManager.getOperationState()
    return {
      isProcessingRequest: operationState.isProcessingRequest,
      isTypingResponse: operationState.isTypingResponse,
      shouldReturnToPrompt: operationState.shouldReturnToPrompt,
      screenWasCleared: this.screenWasCleared
    }
  }


  /**
   * Write output to console (compatibility with CLIInterface API)
   */
  writeOutput(text) {
    console.log(text)
  }

  /**
   * Write warning message (compatibility with CLIInterface API)
   */
  writeWarning(text) {
    console.log(color.yellow + text + color.reset)
  }

  /**
   * Write info message (compatibility with CLIInterface API)
   */
  writeInfo(text) {
    console.log(color.cyan + text + color.reset)
  }

  /**
   * Write error message (compatibility with CLIInterface API)
   */
  writeError(message) {
    console.log(color.red + message + color.reset)
  }

  /**
   * Display context history dots (compatibility with CLIInterface API)
   */
  showContextHistory(historyLength) {
    if (historyLength > 0) {
      const dots = '.'.repeat(historyLength)
      console.log(color.yellow + dots + color.reset)
    }
  }

  /**
   * Handle Ctrl+C interrupt gracefully (same as ESC + exit)
   */
  async handleInterrupt() {
    // Check if we have active requests that need graceful cancellation
    const controller = this.stateManager.getCurrentRequestController()
    
    if (controller && this.stateManager.isProcessingRequest()) {
      // There's an active request - cancel it gracefully like ESC does
      controller.abort()
      
      // Use outputHandler with abort signal like ESC does
      outputHandler.setAbortSignal(controller.signal)
      
      // Clean up streaming state
      if (this.stateManager.isTypingResponse()) {
        this.stateManager.setTypingResponse(false)
        this.stateManager.setShouldReturnToPrompt(true)
      }
      
      // Give brief moment for cancellation to process
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // Now proceed with graceful exit
    await this.exitApp()
  }

  /**
   * Graceful application exit with resource cleanup
   */
  async exitApp() {
    // Предотвращаем повторный вызов
    if (this.isExiting) return
    this.isExiting = true
    
    outputHandler.writeInfo('Shutting down...')
    
    // ФАЗА 1: Немедленно останавливаем пользовательский ввод
    this.stopUserInput()
    
    // ФАЗА 2: Отменяем активные операции
    await this.cancelActiveOperations()
    
    // ФАЗА 3: Финальная очистка и выход
    this.finalCleanup()
  }

  /**
   * Stop user input immediately
   */
  stopUserInput() {
    if (this.rl && !this.rl.closed) {
      this.rl.close() // Разблокирует rl.question()
    }
  }

  /**
   * Cancel active operations and cleanup resources
   */
  async cancelActiveOperations() {
    // Clear all custom ESC handlers
    this.clearAllEscHandlers()
    
    // Отменяем активные LLM запросы (экономия токенов)
    const controller = this.stateManager.getCurrentRequestController()
    if (controller) {
      controller.abort()
      outputHandler.writeWarning('Cancelled pending AI request')
      // Даем время на отправку abort сигнала
      await new Promise(r => setTimeout(r, 100))
    }
    
    // Очищаем таймеры
    const spinnerInterval = this.stateManager.getSpinnerInterval()
    if (spinnerInterval) {
      clearInterval(spinnerInterval)
      this.stateManager.setSpinnerInterval(null)
    }
    
    // Отключаем слушателей событий
    process.stdin.removeAllListeners('keypress')
  }

  /**
   * Final cleanup and process exit
   */
  finalCleanup() {
    // Показываем курсор
    outputHandler.showCursor()
    
    // Прощальное сообщение
    outputHandler.writeSuccess('Goodbye!')
    
    // Даем 50ms на вывод сообщения, затем выход
    setTimeout(() => process.exit(0), 50)
  }

  /**
   * Process streaming response (compatibility with CLIInterface API)
   */
  async processStreamingResponse(stream, streamProcessor, abortController, requestStartTime) {
    let response = []
    let firstChunk = true
    const startTime = requestStartTime || Date.now() // Use passed start time for accurate timing
    
    // Set streaming state
    this.stateManager.setTypingResponse(true)
    
    try {
      const chunkHandler = async (content) => {
        if ((abortController && abortController.signal && abortController.signal.aborted) || this.stateManager.shouldReturnToPrompt()) {
          return
        }
        
        if (firstChunk) {
          // Clear spinner and show success with accurate timing
          const spinnerInterval = this.stateManager.getSpinnerInterval()
          if (spinnerInterval) {
            clearInterval(spinnerInterval)
            this.stateManager.setSpinnerInterval(null)
          }
          
          const finalTime = (Date.now() - startTime) / 1000
          outputHandler.clearLine()
          console.log(`✓ ${finalTime.toFixed(1)}s`)
          console.log() // newline
          
          this.stateManager.setProcessingRequest(false)
          firstChunk = false
        }
        
        if (this.stateManager.isTypingResponse()) {
          process.stdout.write(color.reset + content)
        }
      }
      
      response = await Promise.race([
        streamProcessor.processStream(stream, abortController.signal, chunkHandler),
        new Promise((resolve, reject) => {
          const abortHandler = () => {
            setTimeout(() => reject(new Error('AbortError')), 0)
          }
          
          if (abortController && abortController.signal) {
            abortController.signal.addEventListener('abort', abortHandler, { once: true })
          }
          
          const rapidCheck = () => {
            if (!abortController || !abortController.signal) {
              return
            }
            
            if (streamProcessor.isTerminated || this.stateManager.shouldReturnToPrompt()) {
              setTimeout(() => reject(new Error('AbortError')), 0)
            } else if (!abortController.signal.aborted) {
              setTimeout(rapidCheck, 5)
            }
          }
          rapidCheck()
        })
      ])
      
    } catch (error) {
      if (error.message === 'AbortError' || error.name === 'AbortError' || error.message.includes('aborted')) {
        response = []
      } else {
        throw error
      }
    } finally {
      this.stateManager.setTypingResponse(false)
      this.stateManager.setShouldReturnToPrompt(false)
    }
    
    return response
  }
}