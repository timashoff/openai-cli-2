/**
 * CLIManager - Extracted CLI handling logic from monolith decomposition
 * Handles terminal setup, keypress events, main loop, and user input processing
 */
import readline from 'node:readline/promises'
import * as readlineSync from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getElapsedTime, clearTerminalLine } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'
import { getAllSystemCommands } from '../utils/autocomplete.js'
import { stateObserver, STATE_EVENTS, emitStateEvent } from '../patterns/StateObserver.js'
import { getStateManager } from './StateManager.js'

// Create completer function for system commands autocomplete
function completer(line) {
  const commands = getAllSystemCommands()
  const hits = commands.filter((cmd) => cmd.startsWith(line))
  // Show matches or all commands if no matches
  return [hits.length ? hits : [], line]
}

export class CLIManager {
  constructor(app) {
    this.app = app
    
    // Get StateManager instance
    this.stateManager = getStateManager()
    
    // Create own readline interface
    this.rl = readline.createInterface({ 
      input: process.stdin, 
      output: process.stdout,
      completer // Restored after removing conflicting readline from utils/index.js
    })
    
    // Setup escape key handling through data events (not raw mode)
    this.setupEscapeKeyHandling()
    
    // CLI state (non-StateManager managed)
    this.screenWasCleared = false
    this.keypressEnabled = false
    
    this.setupCleanupHandlers()
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
   * Handle escape key press
   */
  handleEscapeKey() {
    const controller = this.stateManager.getCurrentRequestController()
    const spinnerInterval = this.stateManager.getSpinnerInterval()
    
    if (this.stateManager.isProcessingRequest() && controller) {
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        this.stateManager.setSpinnerInterval(null)
      }
      
      clearTerminalLine()
      controller.abort()
      this.stateManager.setProcessingRequest(false)
      
      const streamProcessor = this.stateManager.requestState.currentStreamProcessor
      if (streamProcessor) {
        streamProcessor.forceTerminate()
      }
      
      process.stdout.write('\x1B[?25h')
      
    } else if (this.stateManager.isTypingResponse()) {
      console.log()
      this.stateManager.setTypingResponse(false)
      this.stateManager.setShouldReturnToPrompt(true)
      process.stdout.write('\x1B[?25h')
    }
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
        const controller = this.stateManager.getCurrentRequestController()
        const spinnerInterval = this.stateManager.getSpinnerInterval()
        
        if (this.stateManager.isProcessingRequest() && controller) {
          if (spinnerInterval) {
            clearInterval(spinnerInterval)
            this.stateManager.setSpinnerInterval(null)
          }
          
          clearTerminalLine()
          controller.abort()
          this.stateManager.setProcessingRequest(false)
          
          const streamProcessor = this.stateManager.requestState.currentStreamProcessor
          if (streamProcessor) {
            streamProcessor.forceTerminate()
          }
          
          process.stdout.write('\x1B[?25h')
          
        } else if (this.stateManager.isTypingResponse()) {
          console.log()
          this.stateManager.setTypingResponse(false)
          this.stateManager.setShouldReturnToPrompt(true)
          process.stdout.write('\x1B[?25h')
        }
      }
    }
    
    // Only enable keypress events when needed for escape handling
    // Don't enable globally as it conflicts with readline
    this.globalKeyPressHandler = globalKeyPressHandler
    
    process.on('SIGINT', () => {
      cleanup()
      console.log('\n[Application terminated by user]')
      process.exit(0)
    })
    
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
        clearTerminalLine()
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
      clearTerminalLine()
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
      clearTerminalLine()
      process.stdout.write('\x1B[?25h') // Show cursor
      throw error
    }
  }

  /**
   * Process user input with validation (extracted from original)
   */
  async processUserInput(userInput) {
    try {
      userInput = sanitizeString(userInput)
      
      if (userInput.length > configManager.get('maxInputLength')) {
        console.log(`${color.red}Error: Input too long (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
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
    if (this.app.state.contextHistory.length) {
      this.app.clearContext()
      console.log(color.yellow + 'Context history cleared')
    } else {
      await new Promise(resolve => {
        setTimeout(() => {
          process.stdout.write('\x1b[2J\x1b[0;0H')
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
    return this.screenWasCleared ? `${colorInput}> ` : `\n${colorInput}> `
  }

  /**
   * Main interaction loop (extracted from original)
   */
  async startMainLoop() {
    logger.debug('🎯 Starting CLI main loop')
    
    // If readline was closed during initialization, recreate it
    if (!this.rl || this.rl.closed) {
      this.rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout,
        completer 
      })
    }
    
    while (true) {
      // Check if readline is still open
      if (!this.rl || this.rl.closed) {
        logger.error('Readline interface was closed, exiting main loop')
        break
      }
      
      const prompt = this.getUserPrompt()
      
      // Emit input waiting event
      emitStateEvent(STATE_EVENTS.INPUT_WAITING, {
        prompt: prompt
      })
      
      let userInput = await this.rl.question(prompt)
      userInput = userInput.trim()
      
      // Emit input received event
      emitStateEvent(STATE_EVENTS.INPUT_RECEIVED, {
        input: userInput,
        length: userInput.length
      })
      
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
        
        const words = processedInput.trim().split(' ')
        const commandName = words[0]
        const args = words.slice(1)
        
        // Delegate command processing to app
        await this.app.processCommand(commandName, args, processedInput)
        
      } catch (error) {
        if (error.message && (error.message.includes('Aborted with Ctrl+C') || 
            error.message === 'AbortError' || error.name === 'AbortError' ||
            error.message.includes('aborted') || error.message.includes('cancelled'))) {
          continue
        }
        errorHandler.handleError(error, { context: 'user_input' })
        continue
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
    
    // Emit state event
    if (value) {
      emitStateEvent(STATE_EVENTS.REQUEST_PROCESSING_STARTED, {
        hasController: !!controller,
        hasStreamProcessor: !!streamProcessor
      })
    } else {
      emitStateEvent(STATE_EVENTS.REQUEST_PROCESSING_STOPPED, {
        reason: 'processing_completed'
      })
    }
    
    // Enable/disable keypress events for escape handling
    if (value) {
      this.enableKeypressEvents()
    } else {
      this.disableKeypressEvents()
    }
  }

  /**
   * Enable keypress events for escape handling (without raw mode)
   */
  enableKeypressEvents() {
    // DISABLED - raw mode conflicts with readline interface
    // Use readline-based escape handling instead
    /*
    if (!this.keypressEnabled) {
      readlineSync.emitKeypressEvents(process.stdin)
      // DO NOT use setRawMode - conflicts with readline
      process.stdin.on('keypress', this.globalKeyPressHandler)
      this.keypressEnabled = true
    }
    */
  }

  /**
   * Disable keypress events
   */
  disableKeypressEvents() {
    // DISABLED - no raw mode to disable
    /*
    if (this.keypressEnabled) {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.removeListener('keypress', this.globalKeyPressHandler)
      this.keypressEnabled = false
    }
    */
  }

  /**
   * Set typing response state
   */
  setTypingResponse(value) {
    // Use StateManager for state management
    this.stateManager.setTypingResponse(value)
    
    // Emit state event
    if (value) {
      emitStateEvent(STATE_EVENTS.RESPONSE_TYPING_STARTED, {
        timestamp: Date.now()
      })
    } else {
      emitStateEvent(STATE_EVENTS.RESPONSE_TYPING_STOPPED, {
        timestamp: Date.now()
      })
    }
  }

  /**
   * Set spinner interval
   */
  setSpinnerInterval(interval) {
    // Use StateManager for state management
    this.stateManager.setSpinnerInterval(interval)
    
    // Emit state event
    if (interval) {
      emitStateEvent(STATE_EVENTS.SPINNER_STARTED, {
        spinnerType: 'default'
      })
    } else {
      emitStateEvent(STATE_EVENTS.SPINNER_STOPPED, {
        reason: 'interval_cleared'
      })
    }
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
}