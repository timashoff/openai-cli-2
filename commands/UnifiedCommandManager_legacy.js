/**
 * UnifiedCommandManager - Centralized registry and router for all commands
 * 
 * Manages unified access to:
 * - System commands (help, exit) 
 * - AI commands (provider, model)
 * - Database commands (add, edit, delete)
 * - Legacy command systems integration
 * 
 * Part of Phase 3.7: Modern Command Pattern completion
 */

import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { databaseCommandService } from '../services/DatabaseCommandService.js'

/**
 * Command Types for unified system
 */
export const COMMAND_TYPES = {
  SYSTEM: 'system',     // help, exit, etc.
  AI: 'ai',            // provider, model switching
  DATABASE: 'database', // SQLite command operations
  LEGACY: 'legacy'     // Existing CommandManager integration
}

/**
 * Command Priority Levels for routing
 */
export const COMMAND_PRIORITIES = {
  CRITICAL: 100,  // System commands (exit, help)
  HIGH: 80,      // AI commands (provider, model)
  NORMAL: 60,    // Database commands
  LOW: 40        // Legacy/fallback commands
}

/**
 * Base Command interface for unified system
 */
export class UnifiedCommand {
  constructor(name, type, handler, options = {}) {
    this.name = name
    this.type = type
    this.handler = handler
    this.aliases = options.aliases || []
    this.description = options.description || ''
    this.priority = options.priority || COMMAND_PRIORITIES.NORMAL
    this.canUndo = options.canUndo || false
    this.undoHandler = options.undoHandler || null
    this.category = options.category || type
    this.usage = options.usage || `${name} [args]`
    this.examples = options.examples || []
  }

  /**
   * Execute the command
   */
  async execute(args = [], context = {}) {
    try {
      logger.debug(`UnifiedCommand: Executing ${this.name} with args:`, args)
      
      const result = await this.handler(args, context)
      
      return {
        success: true,
        result,
        command: this.name,
        type: this.type
      }
    } catch (error) {
      logger.error(`UnifiedCommand: Error executing ${this.name}:`, error)
      
      return {
        success: false,
        error: error.message,
        command: this.name,
        type: this.type
      }
    }
  }

  /**
   * Check if command matches name or aliases
   */
  matches(commandName) {
    const lowerName = commandName.toLowerCase()
    return this.name.toLowerCase() === lowerName || 
           this.aliases.some(alias => alias.toLowerCase() === lowerName)
  }

  /**
   * Undo the command if possible
   */
  async undo(context = {}) {
    if (!this.canUndo || !this.undoHandler) {
      throw new Error(`Command ${this.name} cannot be undone`)
    }

    try {
      const result = await this.undoHandler(context)
      return {
        success: true,
        result,
        undoCommand: this.name
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        undoCommand: this.name
      }
    }
  }
}

/**
 * Unified Command Manager - Single Source of Truth for all commands
 */
export class UnifiedCommandManager {
  constructor() {
    // Command registry organized by type
    this.commands = new Map()
    this.commandsByType = new Map()
    
    // Legacy system integrations
    this.legacySystemCommands = null
    this.legacyAICommands = null
    
    // Statistics
    this.stats = {
      totalCommands: 0,
      executionCount: 0,
      lastExecution: null,
      commandsByType: {}
    }
    
    this.initialized = false
    this.initializationTime = null
  }

  /**
   * Initialize the unified command system
   */
  async initialize(options = {}) {
    if (this.initialized) {
      logger.debug('UnifiedCommandManager: Already initialized')
      return
    }

    const startTime = Date.now()
    logger.info('UnifiedCommandManager: Initializing unified command system...')

    try {
      // Register built-in system commands
      await this.registerBuiltinCommands()
      
      // Initialize statistics tracking
      this.resetStats()
      
      this.initialized = true
      this.initializationTime = Date.now() - startTime
      
      logger.info(`UnifiedCommandManager: Initialized with ${this.stats.totalCommands} commands in ${this.initializationTime}ms`)
      
    } catch (error) {
      logger.error('UnifiedCommandManager: Initialization failed:', error)
      throw error
    }
  }

  /**
   * Register built-in system and AI commands
   */
  async registerBuiltinCommands() {
    // System commands
    this.registerCommand(new UnifiedCommand(
      'help',
      COMMAND_TYPES.SYSTEM,
      this.handleHelpCommand.bind(this),
      {
        aliases: ['h'],
        description: 'Show help information for commands',
        priority: COMMAND_PRIORITIES.CRITICAL,
        usage: 'help [command]',
        examples: ['help', 'help provider', 'help model']
      }
    ))

    this.registerCommand(new UnifiedCommand(
      'exit',
      COMMAND_TYPES.SYSTEM,
      this.handleExitCommand.bind(this),
      {
        aliases: ['q', 'quit'],
        description: 'Exit the application',
        priority: COMMAND_PRIORITIES.CRITICAL,
        usage: 'exit'
      }
    ))

    // AI commands
    this.registerCommand(new UnifiedCommand(
      'provider',
      COMMAND_TYPES.AI,
      this.handleProviderCommand.bind(this),
      {
        aliases: ['p'],
        description: 'Switch AI provider',
        priority: COMMAND_PRIORITIES.HIGH,
        usage: 'provider [provider_name]',
        examples: ['provider', 'provider openai', 'provider anthropic']
      }
    ))

    this.registerCommand(new UnifiedCommand(
      'model',
      COMMAND_TYPES.AI,
      this.handleModelCommand.bind(this),
      {
        aliases: ['m'],
        description: 'Switch AI model',
        priority: COMMAND_PRIORITIES.HIGH,
        usage: 'model [model_name]',
        examples: ['model', 'model gpt-4', 'model claude-3-5-sonnet']
      }
    ))

    logger.debug('UnifiedCommandManager: Built-in commands registered')
  }

  /**
   * Register a command in the unified system
   */
  registerCommand(command) {
    if (!(command instanceof UnifiedCommand)) {
      throw new Error('Command must be an instance of UnifiedCommand')
    }

    // Check for name conflicts
    if (this.commands.has(command.name)) {
      logger.warn(`UnifiedCommandManager: Overriding existing command: ${command.name}`)
    }

    // Register main command
    this.commands.set(command.name, command)
    
    // Register aliases
    command.aliases.forEach(alias => {
      this.commands.set(alias, command)
    })

    // Group by type
    if (!this.commandsByType.has(command.type)) {
      this.commandsByType.set(command.type, new Set())
    }
    this.commandsByType.get(command.type).add(command)

    // Update statistics
    this.stats.totalCommands = this.commands.size
    if (!this.stats.commandsByType[command.type]) {
      this.stats.commandsByType[command.type] = 0
    }
    this.stats.commandsByType[command.type]++

    logger.debug(`UnifiedCommandManager: Registered command "${command.name}" (type: ${command.type})`)
  }

  /**
   * Check if command exists in unified system
   */
  hasCommand(commandName) {
    return this.commands.has(commandName) || this.hasLegacyCommand(commandName)
  }

  /**
   * Get command by name
   */
  getCommand(commandName) {
    return this.commands.get(commandName) || null
  }

  /**
   * Get all commands of specific type
   */
  getCommandsByType(type) {
    const commandSet = this.commandsByType.get(type)
    return commandSet ? Array.from(commandSet) : []
  }

  /**
   * Execute command by name
   */
  async executeCommand(commandName, args = [], context = {}) {
    const startTime = Date.now()
    
    try {
      // Try unified command first
      const command = this.getCommand(commandName)
      if (command) {
        const result = await command.execute(args, context)
        this.recordExecution(commandName, Date.now() - startTime, result.success)
        return result
      }

      // Try legacy command systems
      const legacyResult = await this.executeLegacyCommand(commandName, args, context)
      if (legacyResult) {
        this.recordExecution(commandName, Date.now() - startTime, legacyResult.success)
        return legacyResult
      }

      // Command not found
      return {
        success: false,
        error: `Unknown command: ${commandName}`,
        command: commandName,
        suggestions: this.getSuggestions(commandName)
      }

    } catch (error) {
      logger.error(`UnifiedCommandManager: Error executing ${commandName}:`, error)
      this.recordExecution(commandName, Date.now() - startTime, false)
      
      return {
        success: false,
        error: error.message,
        command: commandName
      }
    }
  }

  /**
   * Built-in command handlers
   */
  async handleHelpCommand(args, context) {
    const [targetCommand] = args
    
    if (targetCommand) {
      return this.getCommandHelp(targetCommand)
    } else {
      return await this.getGeneralHelp()
    }
  }

  async handleExitCommand(args, context) {
    logger.info('UnifiedCommandManager: Exit command executed')
    
    // Graceful shutdown through context
    if (context.app && context.app.shutdown) {
      await context.app.shutdown(0)
    } else {
      process.exit(0)
    }
    
    return { message: 'Goodbye!' }
  }

  async handleProviderCommand(args, context) {
    try {
      // Import and use ProviderCommand
      const { ProviderCommand } = await import('./ProviderCommand.js')
      
      // Create provider command instance with dependencies
      const providerCommand = new ProviderCommand({
        stateManager: context.stateManager,
        cliInterface: context.cliInterface,
        serviceManager: context.app?.serviceManager,
        readline: context.app?.rl || context.app?.cliManager?.rl
      })
      
      // Initialize and execute
      await providerCommand.initialize()
      await providerCommand.execute(args, context)
      
      return {
        message: `Provider command executed successfully`,
        type: 'success'
      }
      
    } catch (error) {
      logger.error('UnifiedCommandManager: Provider command failed:', error)
      return {
        message: `Provider command failed: ${error.message}`,
        type: 'error'
      }
    }
  }

  async handleModelCommand(args, context) {
    try {
      // Import and use ModelCommand
      const { ModelCommand } = await import('./ModelCommand.js')
      
      // Create model command instance with dependencies
      const modelCommand = new ModelCommand({
        stateManager: context.stateManager,
        cliInterface: context.cliInterface,
        serviceManager: context.app?.serviceManager,
        readline: context.app?.rl || context.app?.cliManager?.rl
      })
      
      // Initialize and execute
      await modelCommand.initialize()
      await modelCommand.execute(args, context)
      
      return {
        message: `Model command executed successfully`,
        type: 'success'
      }
      
    } catch (error) {
      logger.error('UnifiedCommandManager: Model command failed:', error)
      return {
        message: `Model command failed: ${error.message}`,
        type: 'error'
      }
    }
  }

  /**
   * Generate help content for specific command
   */
  getCommandHelp(commandName) {
    const command = this.getCommand(commandName)
    if (!command) {
      return `Unknown command: ${commandName}`
    }

    let help = `${color.cyan}${command.name}${color.reset} (${command.type})\n`
    help += `  ${command.description}\n\n`
    help += `${color.yellow}Usage:${color.reset}\n  ${command.usage}\n`
    
    if (command.aliases.length > 0) {
      help += `\n${color.yellow}Aliases:${color.reset}\n  ${command.aliases.join(', ')}\n`
    }
    
    if (command.examples.length > 0) {
      help += `\n${color.yellow}Examples:${color.reset}\n`
      command.examples.forEach(example => {
        help += `  ${example}\n`
      })
    }

    return help
  }

  /**
   * Generate general help content
   */
  async getGeneralHelp() {
    let help = `${color.cyan}Available Commands:${color.reset}\n\n`
    
    // Group commands by type
    for (const [type, commandSet] of this.commandsByType.entries()) {
      const typeCommands = Array.from(commandSet)
        .filter(cmd => cmd.name === cmd.name) // Remove alias duplicates
        .sort((a, b) => b.priority - a.priority)
      
      if (typeCommands.length === 0) continue
      
      help += `${color.yellow}${type.charAt(0).toUpperCase() + type.slice(1)} Commands:${color.reset}\n`
      
      typeCommands.forEach(cmd => {
        const aliasText = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : ''
        help += `  ${cmd.name.padEnd(12)}${aliasText.padEnd(8)} - ${cmd.description}\n`
      })
      help += '\n'
    }

    // Add database commands from DatabaseCommandService
    const dbHelpContent = databaseCommandService.getHelpContent()
    if (dbHelpContent && dbHelpContent.trim() !== 'No database commands available.') {
      help += `${color.yellow}Database Commands:${color.reset}\n`
      help += dbHelpContent
      help += '\n'
    }

    help += `${color.green}Usage:${color.reset}\n`
    help += `  <command> [arguments]     - Execute command\n`
    help += `  help <command>           - Get help for specific command\n`

    return help
  }

  /**
   * Legacy command system integration methods
   */
  setLegacySystemCommands(commandManager) {
    this.legacySystemCommands = commandManager
    logger.debug('UnifiedCommandManager: Legacy system commands integrated')
  }

  setLegacyAICommands(commandManager) {
    this.legacyAICommands = commandManager
    logger.debug('UnifiedCommandManager: Legacy AI commands integrated')
  }

  hasLegacyCommand(commandName) {
    return (this.legacySystemCommands && this.legacySystemCommands.hasCommand(commandName)) ||
           (this.legacyAICommands && this.legacyAICommands.hasCommand(commandName))
  }

  async executeLegacyCommand(commandName, args, context) {
    // Try system commands first
    if (this.legacySystemCommands && this.legacySystemCommands.hasCommand(commandName)) {
      return await this.legacySystemCommands.executeCommand(commandName, args, context)
    }
    
    // Try AI commands
    if (this.legacyAICommands && this.legacyAICommands.hasCommand(commandName)) {
      return await this.legacyAICommands.executeCommand(commandName, args, context)
    }
    
    return null
  }

  /**
   * Command suggestion system
   */
  getSuggestions(input) {
    const suggestions = []
    const inputLower = input.toLowerCase()
    
    for (const [commandName, command] of this.commands.entries()) {
      if (commandName.toLowerCase().includes(inputLower)) {
        suggestions.push(commandName)
      }
    }
    
    return suggestions.slice(0, 3) // Limit to 3 suggestions
  }

  /**
   * Statistics and monitoring
   */
  recordExecution(commandName, executionTime, success) {
    this.stats.executionCount++
    this.stats.lastExecution = {
      command: commandName,
      timestamp: new Date(),
      executionTime,
      success
    }
    
    logger.debug(`UnifiedCommandManager: Executed ${commandName} in ${executionTime}ms (${success ? 'success' : 'failed'})`)
  }

  resetStats() {
    this.stats.executionCount = 0
    this.stats.lastExecution = null
  }

  getStats() {
    return {
      ...this.stats,
      initialized: this.initialized,
      initializationTime: this.initializationTime,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Health check and diagnostics
   */
  getHealthStatus() {
    return {
      initialized: this.initialized,
      totalCommands: this.stats.totalCommands,
      commandsByType: this.stats.commandsByType,
      legacyIntegration: {
        systemCommands: !!this.legacySystemCommands,
        aiCommands: !!this.legacyAICommands
      },
      lastExecution: this.stats.lastExecution,
      isHealthy: this.initialized && this.stats.totalCommands > 0
    }
  }
}

/**
 * Export singleton instance for global usage
 */
export const unifiedCommandManager = new UnifiedCommandManager()

/**
 * Convenience function to initialize the unified command system
 */
export async function initializeUnifiedCommands(options = {}) {
  await unifiedCommandManager.initialize(options)
  return unifiedCommandManager
}

/**
 * Convenience function to register a command
 */
export function registerCommand(name, type, handler, options = {}) {
  const command = new UnifiedCommand(name, type, handler, options)
  unifiedCommandManager.registerCommand(command)
  return command
}