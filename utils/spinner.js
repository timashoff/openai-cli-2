import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { ANSI } from '../config/ansi.js'

// Create a new spinner instance with optional message
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
      process.stdout.write(ANSI.CURSOR.HIDE)

      // Subscribe to abort signal - controller MUST be valid
      if (abortController) {
        abortController.signal.addEventListener(
          'abort',
          () => {
            this.stop('error')
          },
          { once: true },
        )
      }

      // Start spinner animation - clean without checks inside
      interval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const char = UI_SYMBOLS.SPINNER[charIndex++ % UI_SYMBOLS.SPINNER.length]
        process.stdout.write(
          `${ANSI.MOVE.CARRIAGE_RETURN}${char} ${elapsed.toFixed(1)}s${message ? ' ' + message : ''}`,
        )
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
        const symbol =
          status === 'success'
            ? `${ANSI.COLORS.GREEN}${UI_SYMBOLS.CHECK}${ANSI.COLORS.RESET}`
            : `${ANSI.COLORS.RED}${UI_SYMBOLS.CROSS}${ANSI.COLORS.RESET}`
        process.stdout.write(
          `${ANSI.MOVE.CARRIAGE_RETURN}${symbol} ${elapsed.toFixed(1)}s\n`,
        )
      } else {
        // Clear line if operation was too fast
        process.stdout.write(`${ANSI.MOVE.CARRIAGE_RETURN}${ANSI.CLEAR.LINE}`)
      }

      // Show cursor again
      process.stdout.write(ANSI.CURSOR.SHOW)
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
    },
  }

  return spinner
}
