import { BaseService } from './base-service.js'
import { AppError } from '../utils/error-handler.js'
import { getInstructionsFromDatabase } from '../utils/migration.js'

/**
 * Command types enumeration
 * @readonly
 * @enum {string}
 */
export const CommandType = {
  /** System commands (help, exit, etc.) */
  SYSTEM: 'system',
  /** AI-specific commands (provider, model) */
  AI: 'ai',
  /** Instruction-based commands (translation, etc.) */
  INSTRUCTION: 'instruction',
  /** User input for chat */
  CHAT: 'chat'
}

/**
 * Command execution result
 * @typedef {Object} CommandResult
 * @property {boolean} success - Whether command succeeded
 * @property {any} data - Command result data
 * @property {string} type - Command type
 * @property {string} commandName - Command name
 * @property {number} executionTime - Execution time in milliseconds
 * @property {string} error - Error message if failed
 */

/**
 * Parsed command information
 * @typedef {Object} ParsedCommand
 * @property {CommandType} type - Command type
 * @property {string} name - Command name
 * @property {string[]} args - Command arguments
 * @property {Object} flags - Parsed flags
 * @property {string} rawInput - Original input
 * @property {Object} metadata - Additional metadata
 */

/**
 * Service responsible for centralized command processing and routing
 * - Command detection and parsing
 * - Instruction-based command handling  
 * - Custom command management
 * - Command validation and execution
 */
export class CommandService extends BaseService {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.commandManagers = dependencies.commandManagers || {}
    /** @type {Object} */
    this.instructionsDatabase = null
    /** @type {Map<string, Function>} */
    this.commandParsers = new Map()
    /** @type {Map<string, Function>} */
    this.commandValidators = new Map()
    /** @type {Map<string, Object>} */
    this.commandStats = new Map()
    /** @type {string[]} */
    this.translationKeys = ['RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS']
    /** @type {string[]} */
    this.docCommands = ['doc']
    /** @type {string[]} */
    this.forceFlags = [' --force', ' -f']
  }

  /**
   * @override
   */
  getRequiredDependencies() {
    return ['eventBus', 'logger']
  }

  /**
   * @override
   */
  async onInitialize() {
    await this.loadInstructionsDatabase()
    this.setupCommandParsers()
    this.setupCommandValidators()
    this.log('info', 'CommandService initialized')
  }

  /**
   * Parse and classify input command
   * @param {string} input - Raw user input
   * @returns {ParsedCommand} Parsed command information
   * @example
   * const parsed = commandService.parseCommand("provider openai")
   * // Returns: { type: 'ai', name: 'provider', args: ['openai'], ... }
   */
  parseCommand(input) {
    this.ensureReady()
    
    if (!input || typeof input !== 'string') {
      throw new AppError('Input must be a non-empty string', true, 400)
    }

    const trimmedInput = input.trim()
    
    // Check for force flags first
    const { cleanInput, flags } = this.extractFlags(trimmedInput)
    
    // Parse command and arguments
    const words = cleanInput.split(/\s+/)
    const commandName = words[0]
    const args = words.slice(1)
    
    // Determine command type and get metadata
    const commandType = this.determineCommandType(commandName, cleanInput)
    const metadata = this.getCommandMetadata(commandName, commandType, cleanInput)
    
    const parsed = {
      type: commandType,
      name: commandName,
      args,
      flags,
      rawInput: input,
      cleanInput,
      metadata
    }
    
    this.log('debug', `Parsed command: ${commandName}`, { type: commandType, args: args.length })
    return parsed
  }

  /**
   * Execute parsed command
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} context - Execution context
   * @returns {Promise<CommandResult>} Execution result
   */
  async executeCommand(parsedCommand, context = {}) {
    this.ensureReady()
    
    const startTime = Date.now()
    const { type, name, args } = parsedCommand
    
    this.log('info', `Executing command: ${name}`, { type, args: args.length })
    
    try {
      // Validate command
      await this.validateCommand(parsedCommand, context)
      
      // Update statistics
      this.updateCommandStats(name, 'attempted')
      
      // Execute based on type
      let result
      switch (type) {
        case CommandType.SYSTEM:
          result = await this.executeSystemCommand(parsedCommand, context)
          break
          
        case CommandType.AI:
          result = await this.executeAICommand(parsedCommand, context)
          break
          
        case CommandType.INSTRUCTION:
          result = await this.executeInstructionCommand(parsedCommand, context)
          break
          
        default:
          throw new AppError(`Unknown command type: ${type}`, true, 400)
      }
      
      const executionTime = Date.now() - startTime
      
      // Update statistics
      this.updateCommandStats(name, 'succeeded', executionTime)
      
      // Emit success event
      this.emitCommandEvent('executed', parsedCommand, { executionTime, success: true })
      
      return {
        success: true,
        data: result,
        type,
        commandName: name,
        executionTime,
        error: null
      }
      
    } catch (error) {
      const executionTime = Date.now() - startTime
      
      // Update statistics
      this.updateCommandStats(name, 'failed', executionTime, error.message)
      
      // Emit error event
      this.emitCommandEvent('failed', parsedCommand, { 
        executionTime, 
        success: false, 
        error: error.message 
      })
      
      this.log('error', `Command execution failed: ${name}`, { error: error.message })
      
      return {
        success: false,
        data: null,
        type,
        commandName: name,
        executionTime,
        error: error.message
      }
    }
  }

  /**
   * Get instruction-based command information
   * @param {string} input - Raw input
   * @returns {Object|null} Instruction command info or null
   */
  getInstructionCommand(input) {
    const trimmedInput = input.trim()
    const words = trimmedInput.split(' ')
    const commandKey = words.shift()
    
    if (!this.instructionsDatabase) {
      return null
    }
    
    // Find matching instruction
    for (const [prop, instruction] of Object.entries(this.instructionsDatabase)) {
      if (instruction.key && instruction.key.includes(commandKey)) {
        const restString = words.join(' ')
        const isTranslation = this.translationKeys.includes(prop)
        const isDocCommand = prop === 'DOC' || this.docCommands.includes(commandKey)
        
        // Dynamic multi-model detection
        const hasMultipleModels = instruction.models && 
                                  Array.isArray(instruction.models) && 
                                  instruction.models.length > 1
        const isMultiProvider = hasMultipleModels
        
        // Check for URL in content
        const hasUrl = restString && (restString.startsWith('http') || restString.includes('://'))
        
        return {
          fullInstruction: `${instruction.instruction}: ${restString}`,
          isTranslation,
          isDocCommand,
          isMultiProvider,
          hasUrl,
          originalInput: trimmedInput,
          commandKey,
          commandType: prop,
          targetContent: restString,
          instruction: instruction.instruction,
          models: instruction.models || null
        }
      }
    }
    
    return null
  }

  /**
   * Check if input is a system command
   * @param {string} commandName - Command name
   * @returns {boolean} True if system command
   */
  isSystemCommand(commandName) {
    if (!this.instructionsDatabase) return false
    
    for (const prop in this.instructionsDatabase) {
      const instruction = this.instructionsDatabase[prop]
      if (instruction.key && instruction.key.includes(commandName)) {
        return true
      }
    }
    return false
  }

  /**
   * Get command statistics
   * @param {string} commandName - Command name (optional)
   * @returns {Object} Command statistics
   */
  getCommandStats(commandName = null) {
    if (commandName) {
      return this.commandStats.get(commandName) || {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        lastExecuted: null,
        errors: []
      }
    }
    
    // Return all stats
    const allStats = {}
    for (const [cmd, stats] of this.commandStats) {
      allStats[cmd] = { ...stats }
    }
    
    return {
      commands: allStats,
      summary: {
        totalCommands: this.commandStats.size,
        totalAttempted: Array.from(this.commandStats.values()).reduce((sum, s) => sum + s.attempted, 0),
        totalSucceeded: Array.from(this.commandStats.values()).reduce((sum, s) => sum + s.succeeded, 0),
        totalFailed: Array.from(this.commandStats.values()).reduce((sum, s) => sum + s.failed, 0)
      }
    }
  }

  /**
   * Execute system command
   * @private
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} context - Execution context
   * @returns {Promise<any>} Command result
   */
  async executeSystemCommand(parsedCommand, context) {
    const { commandManagers } = this
    
    if (!commandManagers.system) {
      throw new AppError('System command manager not available', true, 503)
    }
    
    return await commandManagers.system.executeCommand(
      parsedCommand.name, 
      parsedCommand.args, 
      context
    )
  }

  /**
   * Execute AI-specific command
   * @private
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} context - Execution context
   * @returns {Promise<any>} Command result
   */
  async executeAICommand(parsedCommand, context) {
    const { commandManagers } = this
    
    if (!commandManagers.ai) {
      throw new AppError('AI command manager not available', true, 503)
    }
    
    return await commandManagers.ai.executeCommand(
      parsedCommand.name, 
      parsedCommand.args, 
      context
    )
  }

  /**
   * Execute instruction-based command
   * @private
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} context - Execution context
   * @returns {Promise<any>} Command result
   */
  async executeInstructionCommand(parsedCommand, context) {
    const instructionInfo = this.getInstructionCommand(parsedCommand.rawInput)
    
    if (!instructionInfo) {
      throw new AppError(`Instruction not found for command: ${parsedCommand.name}`, true, 404)
    }
    
    // Return instruction info for further processing by AI system
    return {
      type: 'instruction',
      instructionInfo,
      needsProcessing: true
    }
  }

  /**
   * Load instructions database
   * @private
   */
  async loadInstructionsDatabase() {
    try {
      this.instructionsDatabase = getInstructionsFromDatabase()
      this.log('info', `Loaded ${Object.keys(this.instructionsDatabase).length} instructions`)
    } catch (error) {
      this.log('error', `Failed to load instructions database: ${error.message}`)
      throw new AppError('Failed to load instructions database', true, 500)
    }
  }

  /**
   * Determine command type
   * @private
   * @param {string} commandName - Command name
   * @param {string} input - Full input
   * @returns {CommandType} Command type
   */
  determineCommandType(commandName, input) {
    // Check for AI commands first
    if (this.commandManagers.ai && this.commandManagers.ai.hasCommand(commandName)) {
      return CommandType.AI
    }
    
    // Check for system commands
    if (this.commandManagers.system && this.commandManagers.system.hasCommand(commandName)) {
      return CommandType.SYSTEM
    }
    
    // Check for instruction-based commands
    if (this.getInstructionCommand(input)) {
      return CommandType.INSTRUCTION
    }
    
    // Default to chat
    return CommandType.CHAT
  }

  /**
   * Get command metadata
   * @private
   * @param {string} commandName - Command name
   * @param {CommandType} commandType - Command type
   * @param {string} input - Full input
   * @returns {Object} Command metadata
   */
  getCommandMetadata(commandName, commandType, input) {
    const metadata = {
      timestamp: new Date(),
      source: 'CommandService'
    }
    
    if (commandType === CommandType.INSTRUCTION) {
      const instructionInfo = this.getInstructionCommand(input)
      if (instructionInfo) {
        metadata.instructionType = instructionInfo.commandType
        metadata.isTranslation = instructionInfo.isTranslation
        metadata.isMultiProvider = instructionInfo.isMultiProvider
        metadata.hasUrl = instructionInfo.hasUrl
      }
    }
    
    return metadata
  }

  /**
   * Extract flags from input
   * @private
   * @param {string} input - Raw input
   * @returns {Object} Clean input and extracted flags
   */
  extractFlags(input) {
    let cleanInput = input
    const flags = {
      force: false
    }
    
    for (const flag of this.forceFlags) {
      if (input.endsWith(flag)) {
        flags.force = true
        cleanInput = input.replace(new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '').trim()
        break
      }
    }
    
    return { cleanInput, flags }
  }

  /**
   * Setup command parsers
   * @private
   */
  setupCommandParsers() {
    // Add custom parsers if needed
    this.commandParsers.set('default', (input) => input.trim().split(/\s+/))
  }

  /**
   * Setup command validators
   * @private
   */
  setupCommandValidators() {
    // Default validator
    this.commandValidators.set('default', async (parsedCommand, context) => {
      if (!parsedCommand.name) {
        throw new AppError('Command name is required', true, 400)
      }
      return true
    })
  }

  /**
   * Validate command
   * @private
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} context - Execution context
   * @returns {Promise<boolean>} Validation result
   */
  async validateCommand(parsedCommand, context) {
    const validator = this.commandValidators.get(parsedCommand.type) || 
                     this.commandValidators.get('default')
    
    if (validator) {
      return await validator(parsedCommand, context)
    }
    
    return true
  }

  /**
   * Update command statistics
   * @private
   * @param {string} commandName - Command name
   * @param {string} action - Action (attempted, succeeded, failed)
   * @param {number} executionTime - Execution time
   * @param {string} error - Error message if failed
   */
  updateCommandStats(commandName, action, executionTime = 0, error = null) {
    if (!this.commandStats.has(commandName)) {
      this.commandStats.set(commandName, {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        lastExecuted: null,
        errors: []
      })
    }
    
    const stats = this.commandStats.get(commandName)
    stats[action]++
    stats.lastExecuted = new Date()
    
    if (executionTime > 0) {
      stats.totalExecutionTime += executionTime
      const totalExecutions = stats.succeeded + stats.failed
      stats.averageExecutionTime = totalExecutions > 0 ? 
        stats.totalExecutionTime / totalExecutions : 0
    }
    
    if (error && stats.errors.length < 10) {
      stats.errors.push({
        error,
        timestamp: new Date()
      })
    }
  }

  /**
   * Emit command event
   * @private
   * @param {string} action - Event action
   * @param {ParsedCommand} parsedCommand - Parsed command
   * @param {Object} data - Event data
   */
  emitCommandEvent(action, parsedCommand, data = {}) {
    this.emitEvent(`command:${action}`, {
      command: parsedCommand.name,
      type: parsedCommand.type,
      args: parsedCommand.args.length,
      ...data
    })
  }

  /**
   * @override
   */
  getCustomMetrics() {
    const stats = this.getCommandStats()
    
    return {
      totalCommands: stats.summary.totalCommands,
      totalAttempted: stats.summary.totalAttempted,
      totalSucceeded: stats.summary.totalSucceeded,
      totalFailed: stats.summary.totalFailed,
      successRate: stats.summary.totalAttempted > 0 ? 
        (stats.summary.totalSucceeded / stats.summary.totalAttempted) * 100 : 0,
      instructionsLoaded: this.instructionsDatabase ? Object.keys(this.instructionsDatabase).length : 0
    }
  }
}