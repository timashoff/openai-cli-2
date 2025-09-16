/**
 * Pure low-level stdout output functions
 * NO formatting, NO colors - only raw terminal operations
 * Single Responsibility: process.stdout manipulation
 */
import { ANSI } from '../../config/ansi.js'

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
    target.write(ANSI.CLEAR.LINE)
    target.write(ANSI.MOVE.CARRIAGE_RETURN)
  },

  /**
   * Hide cursor
   */
  hideCursor() {
    target.write(ANSI.CURSOR.HIDE)
  },

  /**
   * Show cursor
   */
  showCursor() {
    target.write(ANSI.CURSOR.SHOW)
  },

  /**
   * Clear screen and scrollback buffer completely
   */
  clearScreen() {
    target.write(ANSI.CLEAR.SCREEN) // clear visible screen
    // target.write(ANSI.CLEAR.SCROLLBACK)  // clear scrollback buffer
    target.write(ANSI.MOVE.HOME) // move cursor to home position
  },
}
