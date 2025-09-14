/**
 * OutputHandler - Composition of stdout + ui formatting
 * Main export for all output operations in the application
 * Combines low-level stdout operations with high-level formatting
 */

import { stdout } from './stdout.js'
import { ui } from './ui.js'

export const outputHandler = {
  // Re-export all stdout functions
  ...stdout,

  // High-level formatted output functions
  writeError: (text) => stdout.write(ui.error(text)),
  writeSuccess: (text) => stdout.write(ui.success(text)),
  writeWarning: (text) => stdout.write(ui.warning(text)),
  writeInfo: (text) => stdout.write(ui.info(text)),

  // Model formatting - UNIFIED across the app
  writeModel: (model) => stdout.write(ui.model(model)),

  // Stream output for real-time responses (using raw stdout)
  writeStream: (chunk) => stdout.writeRaw(chunk),

  // Format functions (for components that need formatted strings)
  formatSuccess: (text) => ui.success(text),
  formatError: (text) => ui.error(text),
  formatWarning: (text) => ui.warning(text),
  formatInfo: (text) => ui.info(text),
  formatModel: (model) => ui.model(model),

  /**
   * Display context history dots after LLM responses
   * Shows number of dialogs (user+assistant pairs), not individual messages
   */
  writeContextDots(stateManager) {
    const contextHistory = stateManager.getContextHistory()
    if (contextHistory.length > 0) {
      // Count dialogs: each pair of messages (user+assistant) = 1 dialog
      const dialogCount = Math.floor(contextHistory.length / 2)
      if (dialogCount > 0) {
        stdout.write(ui.contextDots(dialogCount))
      }
    }
  },
}