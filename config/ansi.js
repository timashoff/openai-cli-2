/**
 * ANSI Escape Sequences - Single Source of Truth for all terminal control
 * Includes colors, cursor control, clearing, movement, and sound sequences
 * Centralized constants to eliminate hardcoding throughout the application
 */
export const ANSI = {
  /**
   * Color sequences
   */
  COLORS: {
    CYAN: '\x1b[36m',
    GREEN: '\x1b[32m',
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    BOLD: '\x1b[1m',
    ORANGE: '\x1b[38;5;208m',
    ORANGE_LIGHT: '\x1b[38;5;214m',
    ORANGE_DARK: '\x1b[38;5;204m',
    GOLD: '\x1b[38;5;220m',
    LIGHT_GOLDENROD: '\x1b[38;5;222m',
    GREY: '\x1b[90m',
    WHITE: '\x1b[37m',
    BLUE: '\x1b[34m'
  },

  /**
   * Cursor control sequences
   */
  CURSOR: {
    HIDE: '\x1b[?25l',    // Hide cursor
    SHOW: '\x1b[?25h'     // Show cursor
  },

  /**
   * Line and screen clearing sequences
   */
  CLEAR: {
    LINE: '\x1b[2K',                // Clear entire line
    LINE_TO_END: '\x1b[K',          // Clear from cursor to end of line
    SCREEN: '\x1b[2J',              // Clear visible screen
    SCROLLBACK: '\x1b[3J'           // Clear scrollback buffer
  },

  /**
   * Cursor movement sequences
   */
  MOVE: {
    CARRIAGE_RETURN: '\r',          // Move cursor to beginning of line
    HOME: '\x1b[H'                  // Move cursor to home position (0,0)
  },

  /**
   * Terminal sound sequences
   */
  SOUND: {
    BELL: '\x07'                    // Terminal bell sound
  }
}