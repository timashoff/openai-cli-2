import { color } from '../config/color.js'

/**
 * OutputHandler - Single source of truth for ALL application output
 * Functional approach: object with methods (avoiding classes per CLAUDE.md)
 * Centralizes all display logic for consistency and maintainability
 */

const target = process.stdout

// Global abort signal for blocking output after ESC
let globalAbortSignal = null

export const outputHandler = {
  /**
   * Set abort signal to block all output when aborted
   */
  setAbortSignal(signal) {
    globalAbortSignal = signal
  },
  /**
   * Main output method - for normal text with newline
   */
  write: (text) => {
    if (globalAbortSignal && globalAbortSignal.aborted) {
      return
    }
    if (text) {
      target.write(text + '\n')
    }
  },

  /**
   * Stream output - for real-time streaming (no newline)
   */
  writeStream: (chunk) => {
    if (globalAbortSignal && globalAbortSignal.aborted) return
    if (chunk) {
      target.write(chunk)
    }
  },

  /**
   * Success message with green color
   */
  writeSuccess: (text) => {
    target.write(`${color.green}${text}${color.reset}\n`)
  },

  /**
   * Error message with red color
   */
  writeError: (text) => {
    target.write(`${color.red}${text}${color.reset}\n`)
  },

  /**
   * Warning message with yellow color
   */
  writeWarning: (text) => {
    target.write(`${color.yellow}${text}${color.reset}\n`)
  },

  /**
   * Info message with cyan color
   */
  writeInfo: (text) => {
    target.write(`${color.cyan}${text}${color.reset}\n`)
  },

  /**
   * Raw write without newline or color
   */
  writeRaw: (text) => {
    if (globalAbortSignal && globalAbortSignal.aborted) return
    if (text) {
      target.write(text)
    }
  },

  /**
   * Write newline
   */
  writeNewline: () => {
    target.write('\n')
  },

  /**
   * Clear current line
   */
  clearLine: () => {
    target.write('\x1B[2K\r')
  },

  /**
   * Hide cursor
   */
  hideCursor: () => {
    target.write('\x1B[?25l')
  },

  /**
   * Show cursor
   */
  showCursor: () => {
    target.write('\x1B[?25h')
  },

  /**
   * Clear screen and scrollback buffer completely
   */
  clearScreen: () => {
    target.write('\x1b[2J\x1b[3J\x1b[H')
    // \x1b[2J - clear visible screen
    // \x1b[3J - clear scrollback buffer
    // \x1b[H - move cursor to home position
  },

  /**
   * Format success message (for commands to return)
   */
  formatSuccess: (text) => `${color.green}✓ ${text}${color.reset}`,

  /**
   * Format error message (for commands to return)
   */
  formatError: (text) => `${color.red}Error: ${text}${color.reset}`,

  /**
   * Format warning message (for commands to return)
   */
  formatWarning: (text) => `${color.yellow}${text}${color.reset}`,

  /**
   * Format info message (for commands to return)
   */
  formatInfo: (text) => `${color.cyan}${text}${color.reset}`
}
