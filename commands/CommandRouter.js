/**
 * CommandRouter - Extracted command routing logic from monolith decomposition
 * Handles routing between system commands, AI commands, and AI input processing
 */
import { getCommandsFromDB } from '../utils/database-manager.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

export class CommandRouter {
  constructor(app) {
    this.app = app
  }

  /**
   * Main command processing logic (extracted from AIApplication.processCommand)
   */
  async processCommand(commandName, args, fullInput) {
    // Check if command exists in database
    const command = await this.findCommandInDatabase(commandName)
    
    if (command) {
      // Check if it's a system command that should execute directly
      if (this.isSystemCommand(command.id)) {
        await this.handleSystemCommand(commandName, args)
      } else {
        // Translation commands go to AI processing
        await this.handleAIInput(fullInput)
      }
    } else {
      // Fallback to registered commands (legacy)
      if (this.app.commands.hasCommand(commandName) || this.app.aiCommands.hasCommand(commandName)) {
        await this.handleRegisteredCommand(commandName, args)
      } else {
        await this.handleAIInput(fullInput)
      }
    }
  }

  /**
   * Handle system commands (extracted from original logic)
   */
  async handleSystemCommand(commandName, args) {
    switch (commandName) {
      case 'help':
        await this.app.commands.executeCommand('help', args, { app: this.app })
        break
      case 'provider':
        await this.app.providerSwitcher.switchProvider()
        break
      case 'model':
        await this.app.providerSwitcher.switchModel()
        break
      case 'cmd':
      case 'кмд':
        await this.app.commandEditor.showCommandMenu()
        break
      case 'exit':
      case 'q':
        process.exit(0)
        break
      default:
        console.log(`Unknown system command: ${commandName}`)
    }
  }

  /**
   * Handle registered commands (extracted from original logic)
   */
  async handleRegisteredCommand(commandName, args) {
    const startTime = Date.now()
    try {
      let result
      
      if (this.app.aiCommands.hasCommand(commandName)) {
        result = await this.app.aiCommands.executeCommand(commandName, args, {
          app: this.app,
          user: this.app.state.userSession
        })
        if (result) console.log(result)
      } else {
        result = await this.app.commands.executeCommand(commandName, args, {
          app: this.app,
          user: this.app.state.userSession
        })
        if (result) console.log(result)
      }
      
      const duration = Date.now() - startTime
      logger.debug(`Command executed: ${commandName} (${duration}ms)`)
      
    } catch (error) {
      logger.error(`Command failed: ${commandName} - ${error.message}`)
      errorHandler.handleError(error, { context: 'command_execution', command: commandName })
      throw error
    }
  }

  /**
   * Handle AI input processing (extracted from original logic)
   */
  async handleAIInput(fullInput) {
    await this.app.aiProcessor.processAIInput(fullInput, this.app.cliManager)
  }

  /**
   * Find command in database
   */
  async findCommandInDatabase(commandName) {
    const commands = getCommandsFromDB()
    
    for (const [id, command] of Object.entries(commands)) {
      if (command.key && command.key.includes(commandName)) {
        return { id, ...command }
      }
    }
    return null
  }

  /**
   * Check if command is a system command that should execute directly
   */
  isSystemCommand(commandId) {
    const systemCommands = ['HELP', 'PROVIDER', 'MODEL', 'EXIT', 'CMD']
    return systemCommands.includes(commandId)
  }
}