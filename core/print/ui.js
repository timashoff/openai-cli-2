/**
 * Pure UI formatting functions with colors and styles
 * NO output operations - only string formatting
 * Single Responsibility: visual formatting and styling
 */

import { color } from '../../config/color.js'
import { UI_SYMBOLS } from '../../config/constants.js'

export const ui = {
  /**
   * Format error message with red color
   */
  error: (text) => `${color.red}Error: ${text}${color.reset}`,

  /**
   * Format success message with green color and checkmark
   */
  success: (text) => `${color.green}✓ ${text}${color.reset}`,

  /**
   * Format warning message with yellow color
   */
  warning: (text) => `${color.yellow}${text}${color.reset}`,

  /**
   * Format info message with cyan color
   */
  info: (text) => `${color.cyan}${text}${color.reset}`,

  /**
   * Format model name in unified style [model]
   */
  model: (model) => `${color.cyan}[${model.model}]${color.reset}`,


  /**
   * Format context dots based on dialog count
   */
  contextDots: (dialogCount) => {
    if (dialogCount <= 0) return ''
    const brailleDots = UI_SYMBOLS.BRAILLE_DOTS
    return `${color.yellow}${brailleDots[dialogCount - 1]}${color.reset}`
  },

  /**
   * Format current model display
   */
  currentModel: (model) => `current model is ${color.cyan}${model}${color.reset}`,
}