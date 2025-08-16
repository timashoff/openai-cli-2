/**
 * SimpleCLI - Простейший working CLI интерфейс без сложностей
 * Только readline.question() без terminal management
 */
import readline from 'node:readline'
import { color } from '../config/color.js'

export class SimpleCLI {
  constructor() {
    this.rl = null
    this.isInitialized = false
  }
  
  /**
   * Initialize CLI
   */
  async initialize() {
    if (this.isInitialized) {
      return
    }
    
    // Простейший readline без всяких хаков
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    this.isInitialized = true
  }
  
  /**
   * Start simple main loop
   * @param {Function} inputHandler - Function to handle user input
   */
  async startMainLoop(inputHandler) {
    if (!this.isInitialized) {
      throw new Error('SimpleCLI not initialized')
    }
    
    console.log(`${color.green}Interactive mode started. Type 'help' for commands, 'exit' to quit.${color.reset}`)
    
    while (true) {
      try {
        // Простой prompt без цветов и сложностей
        const userInput = await this.question('\n> ')
        
        // Handle empty input
        if (!userInput.trim()) {
          continue
        }
        
        // Handle exit
        if (userInput.trim().toLowerCase() === 'exit' || userInput.trim().toLowerCase() === 'q') {
          this.writeInfo('Goodbye!')
          process.exit(0)
        }
        
        // Process input through handler
        await inputHandler(userInput.trim())
        
      } catch (error) {
        this.writeError(`Error: ${error.message}`)
      }
    }
  }
  
  /**
   * Simple question method
   * @param {string} prompt - Prompt text
   * @returns {Promise<string>} User input
   */
  question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer || '')
      })
    })
  }
  
  /**
   * Write output to console
   * @param {string} text - Text to output
   * @param {string} colorName - Color name (optional)
   */
  writeOutput(text, colorName = null) {
    let output = text
    
    if (colorName && color[colorName]) {
      output = `${color[colorName]}${text}${color.reset}`
    }
    
    console.log(output)
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
   * Cleanup CLI interface
   */
  cleanup() {
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
    this.isInitialized = false
  }
  
  /**
   * Check if interface is initialized
   * @returns {boolean} Initialization status
   */
  isReady() {
    return this.isInitialized
  }
}

/**
 * Create and return a singleton SimpleCLI instance
 */
let simpleCLIInstance = null

export function getSimpleCLI() {
  if (!simpleCLIInstance) {
    simpleCLIInstance = new SimpleCLI()
  }
  return simpleCLIInstance
}

export function resetSimpleCLI() {
  if (simpleCLIInstance) {
    simpleCLIInstance.cleanup()
  }
  simpleCLIInstance = null
}