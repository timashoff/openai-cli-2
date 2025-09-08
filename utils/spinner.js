/**
 * Unified Spinner Utility - Single source of truth for all spinner logic
 * Functional object approach (no classes per CLAUDE.md)
 * Used across the entire application for consistent loading indicators
 */
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { color } from '../config/color.js'

/**
 * Create a new spinner instance
 * @param {string} message - Optional message to display with spinner
 * @returns {Object} Spinner object with start/stop methods
 */
export function createSpinner(message = '') {
  let startTime = null
  let interval = null
  let charIndex = 0
  let isRunning = false
  
  const spinner = {
    start(abortController) {
      if (isRunning) return
      
      isRunning = true
      startTime = Date.now()
      charIndex = 0
      
      // Hide cursor for cleaner animation
      process.stdout.write('\x1B[?25l')
      
      // Subscribe to abort signal - controller MUST be valid
      if (abortController) {
        abortController.signal.addEventListener('abort', () => {
          this.stop('error')
        }, { once: true })
      }
      
      // Start spinner animation - clean without checks inside
      interval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const char = UI_SYMBOLS.SPINNER[charIndex++ % UI_SYMBOLS.SPINNER.length]
        process.stdout.write(`\r${char} ${elapsed.toFixed(1)}s${message ? ' ' + message : ''}`)
      }, APP_CONSTANTS.SPINNER_INTERVAL)
    },
    
    stop(status = 'success') {
      if (!isRunning) return
      
      // Mark as stopped
      isRunning = false
      
      // GUARANTEED interval cleanup
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      
      // Calculate final elapsed time
      const elapsed = (Date.now() - startTime) / 1000
      
      // Show final status (only if operation took time)
      if (elapsed >= 0.1) {
        const symbol = status === 'success' 
          ? `${color.green}${UI_SYMBOLS.CHECK}${color.reset}`
          : `${color.red}${UI_SYMBOLS.CROSS}${color.reset}`
        process.stdout.write(`\r${symbol} ${elapsed.toFixed(1)}s\n`)
      } else {
        // Clear line if operation was too fast
        process.stdout.write('\r\x1B[K')
      }
      
      // Show cursor again
      process.stdout.write('\x1B[?25h')
    },
    
    isActive() {
      return isRunning
    },
    
    getElapsed() {
      if (!startTime) return 0
      return (Date.now() - startTime) / 1000
    },
    
    dispose() {
      this.stop()
    }
  }
  
  return spinner
}