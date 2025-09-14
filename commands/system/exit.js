export const ExitCommand = {
  async execute(args, context) {
    // Use clean interface instead of context.applicationLoop
    if (context.ui && context.ui.exitApp) {
      context.ui.exitApp()
    } else {
      // Fallback if interface is not available
      process.exit(0)
    }
  },
}
