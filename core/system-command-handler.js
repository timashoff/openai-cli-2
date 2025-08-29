/**
 * system-command-handler.js - Handles system commands (help, exit, provider, model, cmd)
 * Functional approach with clean interfaces (NO CLASSES per CLAUDE.md!)
 */
import { logger } from '../utils/logger.js'
import { getSystemCommand, isSystemCommand } from '../config/system-commands.js'
import { outputHandler } from './output-handler.js'
import { API_PROVIDERS } from '../config/api_providers.js'

/**
 * Create clean context interfaces instead of God Object
 * This isolates commands from the entire app, following Interface Segregation Principle
 */
const createCleanContext = (applicationLoop) => {
  // We still need app internally, but commands won't see it
  const app = applicationLoop.app
  
  return {
    // UI interfaces - for user interaction only
    ui: {
      get readline() { return applicationLoop.rl },
      exitApp: () => applicationLoop.exitApp(),
      pauseReadline: () => applicationLoop.pauseReadline(),
      resumeReadline: () => applicationLoop.resumeReadline()
    },
    
    // ESC handler interfaces - for dynamic ESC handling
    esc: {
      register: (handler, description) => applicationLoop.registerEscHandler(handler, description),
      unregister: (handlerId) => applicationLoop.unregisterEscHandler(handlerId),
      clear: () => applicationLoop.clearAllEscHandlers(),
      getHandlers: () => applicationLoop.getEscHandlers()
    },
    
    // Provider interfaces - for AI provider management
    providers: {
      getCurrent: () => app.stateManager.getCurrentProvider(),
      getAvailable: () => {
        return Object.entries(API_PROVIDERS)
          .filter(([key, config]) => process.env[config.apiKeyEnv])
          .map(([key, config]) => ({ 
            key, 
            name: config.name,
            isCurrent: false // Will be set by command
          }))
      },
      switch: async (key) => app.stateManager.switchProvider(key)
    },
    
    // Model interfaces - for AI model management
    models: {
      getCurrent: () => {
        return app.stateManager.getCurrentModel()
      },
      getAvailable: () => {
        return app.stateManager.getAvailableModels()
      },
      switch: async (model) => {
        return await app.stateManager.switchModel(model)
      }
    },
    
    // State interfaces - for application state
    state: {
      getAIState: () => app.stateManager.getAIState(),
      updateProvider: (data) => app.stateManager.updateAIProvider(data),
      updateModel: (model) => app.stateManager.updateModel(model)
    }
  }
}

/**
 * System command handler - functional object (NOT A CLASS!)
 */
export const systemCommandHandler = {
  /**
   * Handle system command execution
   */
  async handle(input, applicationLoop) {
    try {
      const commandName = input.trim().split(' ')[0].toLowerCase()
      const args = input.trim().split(' ').slice(1)
      
      logger.debug(`Executing system command: ${commandName}`)
      
      const systemCommand = getSystemCommand(commandName)
      if (systemCommand) {
        // Dynamically import and execute the command
        const CommandModule = await import(systemCommand.module)
        
        // Try default export first, then named export
        const CommandClass = CommandModule.default || CommandModule[systemCommand.handler]
        if (!CommandClass) {
          throw new Error(`Command not found: ${systemCommand.handler}`)
        }
        
        // Support both classes (legacy) and functional objects
        const commandInstance = typeof CommandClass === 'function' && CommandClass.prototype && CommandClass.prototype.constructor 
          ? new CommandClass() 
          : CommandClass
        
        // Create clean context interfaces (NO GOD OBJECT!)
        const context = createCleanContext(applicationLoop)
        
        const result = await commandInstance.execute(args, context)
        
        // If command returned a string, display it to user
        if (typeof result === 'string' && result.trim()) {
          outputHandler.write(result)
        }
        
        return result
      }
      
      // Command not found
      const errorMsg = `System command not found: ${commandName}`
      applicationLoop.writeError(errorMsg)
      logger.warn(errorMsg)
      return null
      
    } catch (error) {
      const errorMsg = `System command execution failed: ${error.message}`
      applicationLoop.writeError(errorMsg)
      logger.error('System command handler error:', error)
      return null
    }
  },

  /**
   * Check if input is a system command
   */
  isSystemCommand(input) {
    const commandName = input.trim().split(' ')[0].toLowerCase()
    return isSystemCommand(commandName)
  },

  /**
   * Get available system commands
   */
  async getAvailableCommands() {
    const { SYSTEM_COMMANDS } = await import('../config/system-commands.js')
    return Object.keys(SYSTEM_COMMANDS)
  },

  /**
   * Get system command help
   */
  async getCommandHelp(commandName) {
    const systemCommand = getSystemCommand(commandName)
    if (systemCommand) {
      try {
        const CommandModule = await import(systemCommand.module)
        const Command = CommandModule.default || CommandModule[systemCommand.handler]
        
        // Support both classes (legacy) and functional objects
        const commandInstance = typeof Command === 'function' && Command.prototype && Command.prototype.constructor
          ? new Command()
          : Command
          
        return commandInstance.getHelp ? commandInstance.getHelp() : {
          description: systemCommand.description,
          usage: systemCommand.usage,
          aliases: systemCommand.aliases
        }
      } catch (error) {
        logger.error(`Error loading command ${commandName}:`, error)
        return {
          description: systemCommand.description,
          usage: systemCommand.usage,
          aliases: systemCommand.aliases
        }
      }
    }
    return null
  }
}