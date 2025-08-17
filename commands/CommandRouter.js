/**
 * CommandRouter - Extracted command routing logic from monolith decomposition
 * Handles routing between system commands, AI commands, and AI input processing
 */
import { getCommandRepository } from '../patterns/CommandRepository.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'
import { color } from '../config/color.js'

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
      case 'handler-chain':
      case 'hc':
        await this.handleHandlerChainCommand(args)
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
   * Find command in database using Repository Pattern
   */
  async findCommandInDatabase(commandName) {
    try {
      const repository = getCommandRepository()
      const command = await repository.findByKeyword(commandName, { exactMatch: true })
      
      if (command) {
        return { id: command.id, ...command }
      }
      
      return null
    } catch (error) {
      logger.error(`CommandRouter: Failed to find command ${commandName}: ${error.message}`)
      return null
    }
  }

  /**
   * Handle Handler Chain management commands
   */
  async handleHandlerChainCommand(args) {
    const subcommand = args[0]
    
    switch (subcommand) {
      case 'status':
      case 'info':
        this.showHandlerChainStatus()
        break
      case 'enable':
        this.enableHandlerChain()
        break
      case 'disable':
        this.disableHandlerChain()
        break
      case 'stats':
        this.showHandlerChainStats()
        break
      case 'help':
        this.showHandlerChainHelp()
        break
      default:
        this.showHandlerChainHelp()
    }
  }

  /**
   * Show Handler Chain status
   */
  showHandlerChainStatus() {
    const info = this.app.aiProcessor.getHandlerChainInfo()
    
    console.log(`${color.cyan}Handler Chain Status:${color.reset}`)
    console.log(`Initialized: ${info.initialized ? color.green + 'Yes' + color.reset : color.red + 'No' + color.reset}`)
    console.log(`Enabled: ${info.enabled ? color.green + 'Yes' + color.reset : color.red + 'No' + color.reset}`)
    
    if (info.validation) {
      console.log(`Valid: ${info.validation.valid ? color.green + 'Yes' + color.reset : color.red + 'No' + color.reset}`)
      if (info.validation.handlerTypes) {
        console.log(`Chain: ${color.grey}${info.validation.handlerTypes.join(' → ')}${color.reset}`)
      }
      if (!info.validation.valid) {
        console.log(`Error: ${color.red}${info.validation.error}${color.reset}`)
      }
    }
    
    if (info.error) {
      console.log(`Error: ${color.red}${info.error}${color.reset}`)
    }
  }

  /**
   * Enable Handler Chain
   */
  enableHandlerChain() {
    const success = this.app.aiProcessor.setHandlerChainEnabled(true)
    if (success) {
      console.log(`${color.green}✓${color.reset} Handler Chain enabled`)
    } else {
      console.log(`${color.red}✗${color.reset} Failed to enable Handler Chain`)
    }
  }

  /**
   * Disable Handler Chain
   */
  disableHandlerChain() {
    const success = this.app.aiProcessor.setHandlerChainEnabled(false)
    if (success) {
      console.log(`${color.yellow}⏸${color.reset} Handler Chain disabled`)
    } else {
      console.log(`${color.red}✗${color.reset} Failed to disable Handler Chain`)
    }
  }

  /**
   * Show Handler Chain statistics
   */
  showHandlerChainStats() {
    const info = this.app.aiProcessor.getHandlerChainInfo()
    
    if (!info.initialized) {
      console.log(`${color.red}Handler Chain not initialized${color.reset}`)
      return
    }
    
    console.log(`${color.cyan}Handler Chain Statistics:${color.reset}`)
    
    if (info.stats) {
      console.log(`Total Handlers: ${info.stats.totalHandlers}`)
      console.log(`Handler Types:`)
      Object.entries(info.stats.handlerTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`)
      })
      
      if (info.stats.combinedStats) {
        console.log(`Combined Stats:`)
        Object.entries(info.stats.combinedStats).forEach(([handler, stats]) => {
          console.log(`  ${handler}:`, JSON.stringify(stats, null, 2))
        })
      }
    }
    
    if (info.health) {
      console.log(`Health Status:`)
      console.log(`  Healthy: ${info.health.healthyHandlers}/${info.health.totalHandlers}`)
      console.log(`  Overall: ${info.health.overallHealthy ? color.green + 'Healthy' + color.reset : color.red + 'Unhealthy' + color.reset}`)
    }
  }

  /**
   * Show Handler Chain help
   */
  showHandlerChainHelp() {
    console.log(`${color.cyan}Handler Chain Commands:${color.reset}`)
    console.log(`  handler-chain status  - Show chain status`)
    console.log(`  handler-chain enable  - Enable handler chain processing`)
    console.log(`  handler-chain disable - Disable handler chain processing`)
    console.log(`  handler-chain stats   - Show detailed statistics`)
    console.log(`  handler-chain help    - Show this help`)
    console.log()
    console.log(`${color.grey}Short form: hc <command>${color.reset}`)
    console.log(`${color.grey}Example: hc enable${color.reset}`)
  }

  /**
   * Check if command is a system command that should execute directly
   */
  isSystemCommand(commandId) {
    const systemCommands = ['HELP', 'PROVIDER', 'MODEL', 'EXIT', 'CMD', 'HANDLER-CHAIN']
    return systemCommands.includes(commandId)
  }
}