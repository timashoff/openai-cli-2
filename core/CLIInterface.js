/**
 * CLIInterface - Centralized command line interface management
 * Handles input/output, terminal control, and user interaction
 */
import readline from 'node:readline'
import { color } from '../config/color.js'
import { APP_CONSTANTS } from '../config/constants.js'

export class CLIInterface {
  constructor(stateManager) {
    this.stateManager = stateManager
    this.rl = null
    this.isRawMode = false
    this.keyPressHandler = null
    this.isInitialized = false
    
    // Terminal state
    this.terminalState = {
      cursorVisible: true,
      rawModeEnabled: false,
      keyPressListening: false
    }
    
    // Input/output configuration
    this.config = {
      promptSymbol: '>',
      showCursor: true,
      enableColors: true
    }
  }
  
  /**
   * Initialize CLI interface
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    if (this.isInitialized) {
      return
    }
    
    // Merge configuration
    this.config = { ...this.config, ...options }
    
    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      history: [],
      historySize: 100
    })
    
    // Setup terminal
    this.setupTerminal()
    this.isInitialized = true
  }
  
  /**
   * Setup terminal for interactive use
   * @private
   */
  setupTerminal() {
    // НЕ включать keypress events - они вызывают задвоение символов!
    // Используем только readline без дополнительных event listeners
    
    // Raw mode и keypress events отключены для исправления задвоения
  }
  
  /**
   * Setup escape key handler (ОТКЛЮЧЕН для исправления задвоения)
   * @private
   */
  setupEscapeKeyHandler() {
    // ОТКЛЮЧЕНО: keypress events вызывают задвоение символов
    // Escape key handling временно отключен для исправления основной функциональности
  }
  
  /**
   * Enable raw mode for immediate key detection
   * @private
   */
  enableRawMode() {
    if (process.stdin.isTTY && !this.terminalState.rawModeEnabled) {
      process.stdin.setRawMode(true)
      this.terminalState.rawModeEnabled = true
    }
  }
  
  /**
   * Disable raw mode
   * @private
   */
  disableRawMode() {
    if (process.stdin.isTTY && this.terminalState.rawModeEnabled) {
      process.stdin.setRawMode(false)
      this.terminalState.rawModeEnabled = false
    }
  }
  
  
  /**
   * Handle escape key press
   * @private
   */
  handleEscapeKey() {
    const operationState = this.stateManager.getOperationState()
    
    if (operationState.isProcessingRequest) {
      // Cancel current request
      const controller = this.stateManager.getCurrentRequestController()
      if (controller) {
        controller.abort()
      }
      this.showCursor()
      this.clearLine()
      this.writeOutput('\n[Request cancelled by user]', 'yellow')
      this.stateManager.clearRequestState()
    } else if (operationState.isTypingResponse) {
      // Stop response streaming
      this.showCursor()
      this.clearLine()
      this.writeOutput('\n[Response streaming stopped]', 'yellow')
      this.stateManager.setTypingResponse(false)
    }
  }
  
  /**
   * Handle interrupt signal (Ctrl+C)
   * @private
   */
  handleInterrupt() {
    this.writeOutput('\\n[Application terminated by user]', 'red')
    this.cleanup()
    process.exit(0)
  }
  
  /**
   * Get user input with prompt
   * @param {string} promptText - Custom prompt text (optional)
   * @returns {Promise<string>} User input
   */
  async getUserInput(promptText = null) {
    if (!this.isInitialized) {
      throw new Error('CLIInterface not initialized')
    }
    
    // Generate prompt based on current state
    const prompt = promptText || this.generatePrompt()
    
    // Temporarily disable raw mode for input
    const wasRawMode = this.terminalState.rawModeEnabled
    if (wasRawMode) {
      this.disableRawMode()
    }
    
    try {
      // В pipe режиме читаем ввод напрямую из stdin
      if (!process.stdin.isTTY) {
        // Pipe mode - читаем все данные сразу
        return new Promise((resolve) => {
          let data = ''
          
          process.stdin.on('data', (chunk) => {
            data += chunk.toString()
          })
          
          process.stdin.on('end', () => {
            const lines = data.trim().split('\n')
            resolve(lines[0] || '') // Возвращаем первую строку
          })
          
          // Если уже есть данные, обработаем сразу
          if (process.stdin.readableEnded) {
            resolve('')
          }
        })
      }
      
      // Normal interactive mode
      const input = await this.rl.question(prompt)
      return (input || '').trim() // Защита от undefined
    } finally {
      // Restore raw mode if it was enabled
      if (wasRawMode) {
        this.enableRawMode()
      }
    }
  }
  
  /**
   * Generate prompt based on current state
   * @private
   * @returns {string} Formatted prompt
   */
  generatePrompt() {
    if (!this.config.enableColors) {
      return `\\n${this.config.promptSymbol} `
    }
    
    const aiState = this.stateManager.getAIState()
    const promptColor = aiState.model?.includes('chat') ? color.green : color.yellow
    
    return `\\n${promptColor}${this.config.promptSymbol}${color.reset} `
  }
  
  /**
   * Write output to console
   * @param {string} text - Text to output
   * @param {string} colorName - Color name (optional)
   * @param {boolean} newline - Add newline (default: true)
   */
  writeOutput(text, colorName = null, newline = true) {
    let output = text
    
    if (this.config.enableColors && colorName && color[colorName]) {
      output = `${color[colorName]}${text}${color.reset}`
    }
    
    if (newline) {
      console.log(output)
    } else {
      process.stdout.write(output)
    }
  }
  
  /**
   * Write error message
   * @param {string} message - Error message
   */
  writeError(message) {
    this.writeOutput(`Error: ${message}`, 'red')
  }
  
  /**
   * Write success message
   * @param {string} message - Success message
   */
  writeSuccess(message) {
    this.writeOutput(message, 'green')
  }
  
  /**
   * Write warning message
   * @param {string} message - Warning message
   */
  writeWarning(message) {
    this.writeOutput(message, 'yellow')
  }
  
  /**
   * Write info message
   * @param {string} message - Info message
   */
  writeInfo(message) {
    this.writeOutput(message, 'cyan')
  }
  
  /**
   * Clear current line
   */
  clearLine() {
    if (process.stdout.isTTY) {
      process.stdout.write('\\r\\x1b[K')
    }
  }
  
  /**
   * Show cursor
   */
  showCursor() {
    if (this.config.showCursor && process.stdout.isTTY) {
      process.stdout.write('\\x1B[?25h')
      this.terminalState.cursorVisible = true
    }
  }
  
  /**
   * Hide cursor
   */
  hideCursor() {
    if (process.stdout.isTTY) {
      process.stdout.write('\\x1B[?25l')
      this.terminalState.cursorVisible = false
    }
  }
  
  /**
   * Move cursor to beginning of line
   */
  moveCursorToStart() {
    if (process.stdout.isTTY) {
      process.stdout.write('\\r')
    }
  }
  
  /**
   * Show spinner with message
   * @param {string} message - Spinner message
   * @returns {number} Interval ID
   */
  showSpinner(message = 'Processing') {
    if (!process.stdout.isTTY) {
      this.writeOutput(`${message}...`)
      return null
    }
    
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let index = 0
    
    const interval = setInterval(() => {
      this.clearLine()
      this.writeOutput(`${spinnerChars[index]} ${message}`, 'cyan', false)
      index = (index + 1) % spinnerChars.length
    }, 100)
    
    this.stateManager.setSpinnerInterval(interval)
    return interval
  }
  
  /**
   * Hide spinner
   * @param {number} interval - Interval ID to clear
   */
  hideSpinner(interval = null) {
    const spinnerInterval = interval || this.stateManager.requestState?.currentSpinnerInterval
    
    if (spinnerInterval) {
      clearInterval(spinnerInterval)
      this.stateManager.setSpinnerInterval(null)
    }
    
    this.clearLine()
  }
  
  /**
   * Display context history dots
   * @param {number} historyLength - Length of context history
   */
  showContextHistory(historyLength) {
    if (historyLength > 0) {
      const dots = '.'.repeat(historyLength)
      this.writeOutput(dots, 'yellow')
    }
  }

  /**
   * Process streaming response with escape key support
   * @param {AsyncIterable} stream - Response stream
   * @param {Object} streamProcessor - Stream processor instance
   * @param {AbortController} abortController - Request controller
   * @param {Function} onChunk - Chunk processing callback
   * @returns {Promise<Array>} Response chunks
   */
  async processStreamingResponse(stream, streamProcessor, abortController, onChunk) {
    let response = []
    let firstChunk = true
    const startTime = Date.now()
    
    // Set streaming state
    this.stateManager.setTypingResponse(true)
    
    try {
      const chunkHandler = async (content) => {
        if (abortController?.signal?.aborted || this.stateManager.shouldReturnToPrompt()) {
          return
        }
        
        if (firstChunk) {
          // Clear spinner and show success
          const finalTime = (Date.now() - startTime) / 1000
          this.clearLine()
          this.writeOutput(`✓ ${finalTime.toFixed(1)}s`, 'green', false)
          this.writeOutput('') // newline
          
          this.stateManager.setProcessingRequest(false)
          firstChunk = false
        }
        
        if (this.stateManager.isTypingResponse()) {
          process.stdout.write(content)
        }
        
        if (onChunk) {
          await onChunk(content)
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

  /**
   * Show status with timing information
   * @param {string} status - Status type (success, error)
   * @param {number} elapsed - Elapsed time in seconds
   * @param {string} message - Additional message
   */
  showStatus(status, elapsed, message = '') {
    const statusSymbol = status === 'success' ? '✓' : '✗'
    const statusColor = status === 'success' ? 'green' : 'red'
    const timeStr = `${elapsed.toFixed(1)}s`
    
    this.clearLine()
    
    if (message) {
      this.writeOutput(`${statusSymbol} ${timeStr} - ${message}`, statusColor)
    } else {
      this.writeOutput(`${statusSymbol} ${timeStr}`, statusColor)
    }
  }
  
  /**
   * Ask for confirmation
   * @param {string} question - Confirmation question
   * @returns {Promise<boolean>} User confirmation
   */
  async askConfirmation(question) {
    const response = await this.getUserInput(`${question} (y/N): `)
    return response.toLowerCase().startsWith('y')
  }
  
  /**
   * Display menu and get selection
   * @param {string} title - Menu title
   * @param {Array} options - Menu options
   * @returns {Promise<number>} Selected option index
   */
  async showMenu(title, options) {
    this.writeOutput(`\\n${title}`)
    
    options.forEach((option, index) => {
      this.writeOutput(`  ${index + 1}. ${option}`)
    })
    
    while (true) {
      const response = await this.getUserInput('Select option (number): ')
      const selection = parseInt(response, 10)
      
      if (selection >= 1 && selection <= options.length) {
        return selection - 1
      }
      
      this.writeError(`Please select a number between 1 and ${options.length}`)
    }
  }
  
  /**
   * Start main application loop (used by app-refactored.js)
   * @param {Function} inputHandler - Function to handle user input
   */
  async startMainLoop(inputHandler) {
    if (!this.isInitialized) {
      throw new Error('CLIInterface not initialized')
    }
    
    if (typeof inputHandler !== 'function') {
      throw new Error('Input handler must be a function')
    }
    
    let emptyInputCount = 0
    const MAX_EMPTY_INPUTS = 10
    
    while (true) {
      try {
        // Get user input
        const userInput = await this.getUserInput()
        
        // Handle empty input
        if (!userInput) {
          emptyInputCount++
          
          // В pipe режиме быстро завершаем при первом же пустом вводе
          if (!process.stdin.isTTY) {
            console.log('[DEBUG] Empty input in pipe mode, exiting...')
            process.exit(0)
          }
          
          // В интерактивном режиме - защита от частых пустых вводов
          if (emptyInputCount > MAX_EMPTY_INPUTS) {
            await new Promise(resolve => setTimeout(resolve, 100))
            emptyInputCount = 0
          }
          
          const contextHistory = this.stateManager.getContextHistory()
          if (contextHistory.length > 0) {
            this.stateManager.clearContext()
            this.writeWarning('Context history cleared')
          }
          continue
        }
        
        emptyInputCount = 0 // Reset counter on valid input
        
        // Process input through handler
        await inputHandler(userInput)
        
      } catch (error) {
        if (error.name === 'AbortError') {
          // Request was cancelled, continue loop
          continue
        }
        
        // Handle critical initialization errors
        if (error.message && error.message.includes('trim')) {
          this.writeError(`Critical input error: ${error.message}`)
          this.writeError('CLI interface may not be properly initialized')
          break // Выйти из цикла при критических ошибках
        }
        
        this.writeError(`Interaction error: ${error.message}`)
        
        // For critical errors, break the loop
        if (error.fatal) {
          break
        }
      }
    }
  }

  /**
   * Start main interaction loop
   * @param {Function} inputHandler - Function to handle user input
   */
  async startInteractionLoop(inputHandler) {
    // Delegate to startMainLoop for compatibility
    return await this.startMainLoop(inputHandler)
  }
  
  /**
   * Cleanup CLI interface
   */
  cleanup() {
    // Remove keypress listener
    if (this.keyPressHandler && this.terminalState.keyPressListening) {
      process.stdin.removeListener('keypress', this.keyPressHandler)
      this.terminalState.keyPressListening = false
    }
    
    // Disable raw mode
    this.disableRawMode()
    
    // Show cursor
    this.showCursor()
    
    // Close readline interface
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    
    this.isInitialized = false
  }
  
  /**
   * Get readline interface
   * @returns {Object} Readline interface
   */
  getReadlineInterface() {
    return this.rl
  }
  
  /**
   * Check if interface is initialized
   * @returns {boolean} Initialization status
   */
  isReady() {
    return this.isInitialized
  }
  
  /**
   * Get terminal state information
   * @returns {Object} Terminal state
   */
  getTerminalState() {
    return {
      ...this.terminalState,
      isTTY: process.stdout.isTTY,
      columns: process.stdout.columns,
      rows: process.stdout.rows
    }
  }
}

/**
 * Create and return a singleton CLIInterface instance
 */
let cliInterfaceInstance = null

export function getCLIInterface(stateManager) {
  if (!cliInterfaceInstance) {
    if (!stateManager) {
      throw new Error('StateManager is required to create CLIInterface')
    }
    cliInterfaceInstance = new CLIInterface(stateManager)
  }
  return cliInterfaceInstance
}

export function resetCLIInterface() {
  if (cliInterfaceInstance) {
    cliInterfaceInstance.cleanup()
  }
  cliInterfaceInstance = null
}