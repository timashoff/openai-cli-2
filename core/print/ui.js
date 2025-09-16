/**
 * Pure UI formatting functions with colors and styles
 * NO output operations - only string formatting
 * Single Responsibility: visual formatting and styling
 */

import { ANSI } from '../../config/ansi.js'
import { UI_SYMBOLS } from '../../config/constants.js'

export const ui = {
  /**
   * Format error message with red color
   */
  error: (text) => `${ANSI.COLORS.RED}Error: ${text}${ANSI.COLORS.RESET}`,

  /**
   * Format success message with green color and checkmark
   */
  success: (text) => `${ANSI.COLORS.GREEN}✓ ${text}${ANSI.COLORS.RESET}`,

  /**
   * Format warning message with yellow color
   */
  warning: (text) => `${ANSI.COLORS.YELLOW}${text}${ANSI.COLORS.RESET}`,

  /**
   * Format info message with cyan color
   */
  info: (text) => `${ANSI.COLORS.CYAN}${text}${ANSI.COLORS.RESET}`,

  /**
   * Format model name in unified style [model]
   */
  model: (model) => `${ANSI.COLORS.CYAN}[${model.model}]${ANSI.COLORS.RESET}`,


  /**
   * Format context dots based on dialog count
   */
  contextDots: (dialogCount) => {
    if (dialogCount <= 0) return ''
    const brailleDots = UI_SYMBOLS.BRAILLE_DOTS
    return `${ANSI.COLORS.YELLOW}${brailleDots[dialogCount - 1]}${ANSI.COLORS.RESET}`
  },

  /**
   * Format current model display
   */
  currentModel: (model) => `current model is ${ANSI.COLORS.CYAN}${model}${ANSI.COLORS.RESET}`,
}