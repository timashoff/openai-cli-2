import { AppError } from './error-handler.js'
import { logger } from './logger.js'
import { validateString, validateObject } from './validation.js'

/**
 * Base command class
 */
export class BaseCommand {
  constructor(name, description, options = {}) {
    this.name = name
    this.description = description
    this.aliases = options.aliases || []
    this.usage = options.usage || ''
    this.examples = options.examples || []
    this.category = options.category || 'general'
    this.hidden = options.hidden || false
  }

  /**
   * Execute command - must be implemented by subclasses
   */
  async execute(args, context) {
    throw new Error(`Command ${this.name} must implement execute method`)
  }

  /**
   * Validate command arguments
   */
  validateArgs(args) {
    return true
  }

  /**
   * Get command help
   */
  getHelp() {
    let help = `${this.name} - ${this.description}\n`
    
    if (this.usage) {
      help += `Usage: ${this.usage}\n`
    }
    
    if (this.aliases.length > 0) {
      help += `Aliases: ${this.aliases.join(', ')}\n`
    }
    
    if (this.examples.length > 0) {
      help += `Examples:\n${this.examples.map(ex => `  ${ex}`).join('\n')}\n`
    }
    
    return help
  }
}

/**
 * Command manager with registration and execution
 */
export class CommandManager {
  constructor() {
    this.commands = new Map()
    this.aliases = new Map()
    this.categories = new Map()
    this.history = []
    this.maxHistorySize = 100
  }

  /**
   * Register a command
   */
  registerCommand(command) {
    if (!(command instanceof BaseCommand)) {
      throw new AppError('Command must be an instance of BaseCommand', true, 400)
    }
    
    if (this.commands.has(command.name)) {
      throw new AppError(`Command ${command.name} is already registered`, true, 400)
    }
    
    this.commands.set(command.name, command)
    
    // Register aliases
    for (const alias of command.aliases) {
      if (this.aliases.has(alias)) {
        throw new AppError(`Alias ${alias} is already registered`, true, 400)
      }
      this.aliases.set(alias, command.name)
    }
    
    // Add to category
    if (!this.categories.has(command.category)) {
      this.categories.set(command.category, [])
    }
    this.categories.get(command.category).push(command)
    
    logger.debug(`Command ${command.name} registered in category ${command.category}`)
  }

  /**
   * Get command by name or alias
   */
  getCommand(name) {
    const commandName = this.aliases.get(name) || name
    return this.commands.get(commandName)
  }

  /**
   * Check if command exists
   */
  hasCommand(name) {
    return this.commands.has(name) || this.aliases.has(name)
  }

  /**
   * Execute a command
   */
  async executeCommand(commandName, args = [], context = {}) {
    const command = this.getCommand(commandName)
    
    if (!command) {
      throw new AppError(`Command ${commandName} not found`, true, 404)
    }
    
    try {
      // Validate arguments
      if (!command.validateArgs(args)) {
        throw new AppError(`Invalid arguments for command ${commandName}`, true, 400)
      }
      
      // Add to history
      this.addToHistory(commandName, args)
      
      // Execute command
      const startTime = Date.now()
      const result = await command.execute(args, context)
      const duration = Date.now() - startTime
      
      logger.debug(`Command ${commandName} executed in ${duration}ms`)
      
      return result
    } catch (error) {
      logger.error(`Command ${commandName} failed:`, error.message)
      throw error
    }
  }

  /**
   * Add command to history
   */
  addToHistory(commandName, args) {
    this.history.unshift({
      command: commandName,
      args: args.slice(),
      timestamp: Date.now()
    })
    
    if (this.history.length > this.maxHistorySize) {
      this.history.pop()
    }
  }

  /**
   * Get command history
   */
  getHistory(limit = 10) {
    return this.history.slice(0, limit)
  }

  /**
   * Clear command history
   */
  clearHistory() {
    this.history = []
  }

  /**
   * Get all commands
   */
  getAllCommands() {
    return Array.from(this.commands.values()).filter(cmd => !cmd.hidden)
  }

  /**
   * Get commands by category
   */
  getCommandsByCategory(category) {
    return this.categories.get(category) || []
  }

  /**
   * Get all categories
   */
  getCategories() {
    return Array.from(this.categories.keys())
  }

  /**
   * Search commands
   */
  searchCommands(query) {
    const results = []
    const lowercaseQuery = query.toLowerCase()
    
    for (const command of this.commands.values()) {
      if (command.hidden) continue
      
      const score = this.calculateSearchScore(command, lowercaseQuery)
      if (score > 0) {
        results.push({ command, score })
      }
    }
    
    return results.sort((a, b) => b.score - a.score).map(r => r.command)
  }

  /**
   * Calculate search score for a command
   */
  calculateSearchScore(command, query) {
    let score = 0
    
    // Exact name match
    if (command.name.toLowerCase() === query) {
      score += 100
    }
    
    // Name contains query
    if (command.name.toLowerCase().includes(query)) {
      score += 50
    }
    
    // Alias matches
    for (const alias of command.aliases) {
      if (alias.toLowerCase() === query) {
        score += 80
      }
      if (alias.toLowerCase().includes(query)) {
        score += 30
      }
    }
    
    // Description contains query
    if (command.description.toLowerCase().includes(query)) {
      score += 20
    }
    
    return score
  }

  /**
   * Get command suggestions based on partial input
   */
  getSuggestions(partial) {
    const results = []
    const lowercasePartial = partial.toLowerCase()
    
    for (const [name, command] of this.commands) {
      if (command.hidden) continue
      
      if (name.toLowerCase().startsWith(lowercasePartial)) {
        results.push(name)
      }
    }
    
    for (const [alias, commandName] of this.aliases) {
      if (alias.toLowerCase().startsWith(lowercasePartial)) {
        results.push(alias)
      }
    }
    
    return results.sort()
  }

  /**
   * Generate help text for all commands
   */
  generateHelp(category = null) {
    let help = 'Available commands:\n\n'
    
    const categories = category ? [category] : this.getCategories()
    
    for (const cat of categories) {
      const commands = this.getCommandsByCategory(cat)
      if (commands.length === 0) continue
      
      help += `${cat.toUpperCase()}:\n`
      
      for (const command of commands) {
        if (command.hidden) continue
        help += `  ${command.name.padEnd(20)} ${command.description}\n`
      }
      
      help += '\n'
    }
    
    return help
  }

  /**
   * Get command statistics
   */
  getStats() {
    const total = this.commands.size
    const visible = this.getAllCommands().length
    const hidden = total - visible
    
    return {
      total,
      visible,
      hidden,
      categories: this.categories.size,
      aliases: this.aliases.size,
      historySize: this.history.length
    }
  }
}

// Export singleton instance
export const commandManager = new CommandManager()