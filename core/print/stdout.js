/**
 * Pure low-level stdout output functions
 * NO formatting, NO colors - only raw terminal operations
 * Single Responsibility: process.stdout manipulation
 */

const target = process.stdout

// Global abort signal for blocking output after ESC
let globalAbortSignal = null

export const stdout = {
  /**
   * Set abort signal to block all output when aborted
   */
  setAbortSignal(signal) {
    globalAbortSignal = signal
  },

  /**
   * Write text with newline
   */
  write(text) {
    if (globalAbortSignal && globalAbortSignal.aborted) {
      return
    }
    if (text) {
      target.write(text + '\n')
    }
  },

  /**
   * Write raw text without newline (for streaming)
   */
  writeRaw(chunk) {
    if (globalAbortSignal && globalAbortSignal.aborted) return
    if (chunk) {
      target.write(chunk)
    }
  },

  /**
   * Write newline only
   */
  writeNewline() {
    target.write('\n')
  },

  /**
   * Clear current line
   */
  clearLine() {
    target.write('\x1B[2K\r')
  },

  /**
   * Hide cursor
   */
  hideCursor() {
    target.write('\x1B[?25l')
  },

  /**
   * Show cursor
   */
  showCursor() {
    target.write('\x1B[?25h')
  },

  /**
   * Clear screen and scrollback buffer completely
   */
  clearScreen() {
    target.write('\x1b[2J\x1b[3J\x1b[H')
    // \x1b[2J - clear visible screen
    // \x1b[3J - clear scrollback buffer
    // \x1b[H - move cursor to home position
  },
}