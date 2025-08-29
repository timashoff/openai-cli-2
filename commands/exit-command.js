/**
 * exit-command.js - Exit command implementation
 * Functional approach (NO CLASSES per CLAUDE.md!)
 */

export const ExitCommand = {
  /**
   * Execute exit command
   */
  async execute(args, context) {
    // Use clean interface instead of context.applicationLoop
    if (context.ui && context.ui.exitApp) {
      context.ui.exitApp()
    } else {
      // Fallback if interface is not available
      process.exit(0)
    }
  }
}