/**
 * Simple command handler that works with existing AIApplication architecture
 * Acts as a bridge between handler chain and existing command processing
 */
export class SimpleCommandHandler {
  constructor(app) {
    this.app = app
    this.name = 'SimpleCommandHandler'
  }

  async canHandle(context) {
    try {
      // Use existing findCommand logic to check for commands
      const command = this.app.findCommand(context.input)
      
      if (command) {
        // Store command info for processing
        context.commandInfo = command
        return true
      }
      
      // Check for system commands (help, exit, status, etc.)
      const words = context.input.trim().split(' ')
      const firstWord = words[0].toLowerCase()
      
      if (['help', 'exit', 'quit', 'clear', 'status', 'provider', 'model', 'models', 'list'].includes(firstWord)) {
        context.systemCommand = {
          name: firstWord,
          args: words.slice(1)
        }
        return true
      }
      
      return false
    } catch (error) {
      console.warn('SimpleCommandHandler.canHandle error:', error)
      return false
    }
  }

  async handle(context) {
    try {
      // Handle instruction commands (translation, grammar, etc.)
      if (context.commandInfo) {
        // Add command info to context for next handlers
        context.instructionCommand = context.commandInfo
        return {
          handled: false, // Pass through to next handler for AI processing
          type: 'instruction',
          commandKey: context.commandInfo.commandKey,
          instruction: context.commandInfo.instruction || context.commandInfo.fullInstruction
        }
      }
      
      // Handle system commands directly
      if (context.systemCommand) {
        const result = await this.executeSystemCommand(context.systemCommand)
        return {
          handled: true,
          type: 'system',
          result: result
        }
      }
      
      return { handled: false }
    } catch (error) {
      console.error('SimpleCommandHandler.handle error:', error)
      return {
        handled: true,
        type: 'error',
        error: error.message
      }
    }
  }

  async executeSystemCommand(systemCommand) {
    try {
      switch (systemCommand.name) {
        case 'help':
          return this.app.showHelp ? await this.app.showHelp() : 'Available commands: help, exit, status, provider, model'
          
        case 'exit':
        case 'quit':
          process.exit(0)
          
        case 'status':
          return `Current provider: ${this.app.aiState?.selectedProviderKey || 'none'}, Model: ${this.app.aiState?.model || 'none'}`
          
        case 'provider':
          if (systemCommand.args.length > 0) {
            // Switch provider logic
            return `Provider switching to: ${systemCommand.args[0]}`
          } else {
            return `Current provider: ${this.app.aiState?.selectedProviderKey || 'none'}`
          }
          
        case 'model':
        case 'models':
          if (this.app.listModels) {
            return await this.app.listModels()
          }
          return `Current model: ${this.app.aiState?.model || 'none'}`
          
        default:
          return `Unknown system command: ${systemCommand.name}`
      }
    } catch (error) {
      return `Error executing system command: ${error.message}`
    }
  }
}