import { BaseRequestHandler } from './base-handler.js'
import { CommandType } from '../utils/services-adapter.js'
import { AppError } from '../utils/error-handler.js'
import { color } from '../config/color.js'

/**
 * Handler for routing and executing commands (system, AI, instruction-based)
 * Determines command type and delegates to appropriate command manager
 */
export class CommandHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.commandService = dependencies.commandService
    /** @type {Map<string, number>} */
    this.commandStats = new Map()
    /** @type {Date} */
    this.lastCommandExecution = null
  }

  /**
   */
  async canHandle(context) {
    if (!this.commandService) {
      return false
    }
    
    try {
      const parsedCommand = this.commandService.parseCommand(context.processedInput)
      
      // Can handle if it's a recognized command type
      return parsedCommand.type !== CommandType.CHAT
      
    } catch (error) {
      this.log('debug', `Command parsing failed: ${error.message}`)
      return false
    }
  }

  /**
   */
  async process(context) {
    try {
      // Parse the command
      const parsedCommand = this.commandService.parseCommand(context.processedInput)
      
      this.log('info', `Processing ${parsedCommand.type} command: ${parsedCommand.name}`)
      
      // Add parsed command to context for other handlers
      context.command = parsedCommand
      
      // Execute the command
      const result = await this.executeCommand(parsedCommand, context)
      
      // Update statistics
      this.updateCommandStats(parsedCommand.type, parsedCommand.name, true)
      this.lastCommandExecution = new Date()
      
      // Emit command execution event
      this.emitEvent('command:executed', {
        type: parsedCommand.type,
        name: parsedCommand.name,
        success: result.success,
        executionTime: result.executionTime
      })
      
      // Handle different result types
      return this.handleCommandResult(result, parsedCommand, context)
      
    } catch (error) {
      this.log('error', `Command execution failed: ${error.message}`)
      
      // Update error statistics
      this.updateCommandStats('unknown', 'unknown', false, error.message)
      
      // Emit error event
      this.emitEvent('command:error', {
        error: error.message,
        input: context.processedInput.substring(0, 100)
      })
      
      // Show user-friendly error
      console.log(`${color.red}Command error: ${this.getUserFriendlyError(error)}${color.reset}`)
      
      // Stop chain on command errors
      return this.createResult(null, { stopChain: true })
    }
  }

  /**
   * Execute command through command service



   */
  async executeCommand(parsedCommand, context) {
    // Create execution context for command service
    const executionContext = {
      app: context.services.app || null,
      user: context.services.userSession || null,
      services: context.services,
      flags: context.flags || {},
      metadata: context.metadata || {}
    }
    
    // Use error boundary for command execution
    if (this.errorBoundary) {
      return await this.errorBoundary.execute(
        () => this.commandService.executeCommand(parsedCommand, executionContext),
        {
          operation: 'command_execution',
          component: 'CommandHandler',
          metadata: {
            commandType: parsedCommand.type,
            commandName: parsedCommand.name
          }
        }
      )
    } else {
      return await this.commandService.executeCommand(parsedCommand, executionContext)
    }
  }

  /**
   * Handle different types of command results




   */
  handleCommandResult(result, parsedCommand, context) {
    if (!result.success) {
      // Command failed - show error and stop chain
      console.log(`${color.red}Command failed: ${result.error}${color.reset}`)
      return this.createResult(null, { stopChain: true })
    }
    
    // Handle different command types
    switch (parsedCommand.type) {
      case CommandType.SYSTEM:
        return this.handleSystemCommandResult(result, parsedCommand)
        
      case CommandType.AI:
        return this.handleAICommandResult(result, parsedCommand)
        
      case CommandType.INSTRUCTION:
        return this.handleInstructionCommandResult(result, parsedCommand, context)
        
      default:
        this.log('warn', `Unknown command type: ${parsedCommand.type}`)
        return this.createResult(result.data, { stopChain: true })
    }
  }

  /**
   * Handle system command result



   */
  handleSystemCommandResult(result, parsedCommand) {
    // System commands typically show output and stop processing
    if (result.data && typeof result.data === 'string') {
      console.log(result.data)
    }
    
    // Special handling for exit commands
    if (parsedCommand.name === 'exit' || parsedCommand.name === 'quit') {
      this.emitEvent('system:exit-requested')
      process.exit(0)
    }
    
    return this.createResult(result.data, { stopChain: true })
  }

  /**
   * Handle AI command result



   */
  handleAICommandResult(result, parsedCommand) {
    // AI commands typically show output and stop processing
    if (result.data && typeof result.data === 'string') {
      console.log(result.data)
    }
    
    // Some AI commands might modify application state
    // (e.g., provider switching, model changes)
    this.emitEvent('ai-command:executed', {
      command: parsedCommand.name,
      result: result.data
    })
    
    return this.createResult(result.data, { stopChain: true })
  }

  /**
   * Handle instruction command result




   */
  handleInstructionCommandResult(result, parsedCommand, context) {
    // Instruction commands need further processing by AI
    if (result.data && result.data.needsProcessing) {
      // Add instruction info to context and continue chain
      context.instructionInfo = result.data.instructionInfo
      context.metadata.isInstructionCommand = true
      
      this.log('info', `Instruction command processed, continuing to AI: ${parsedCommand.name}`)
      
      // Continue processing chain for AI to handle the instruction
      return this.createPassThrough(context.processedInput, {
        instructionProcessed: true,
        instructionType: result.data.instructionInfo.commandType,
        isTranslation: result.data.instructionInfo.isTranslation,
        isMultiProvider: result.data.instructionInfo.isMultiProvider
      })
    }
    
    // Direct result from instruction
    return this.createResult(result.data, { stopChain: true })
  }

  /**
   * Update command statistics




   */
  updateCommandStats(commandType, commandName, success, error = null) {
    const key = `${commandType}:${commandName}`
    const current = this.commandStats.get(key) || {
      total: 0,
      success: 0,
      errors: 0,
      lastExecuted: null,
      recentErrors: []
    }
    
    current.total++
    current.lastExecuted = new Date()
    
    if (success) {
      current.success++
    } else {
      current.errors++
      if (error && current.recentErrors.length < 3) {
        current.recentErrors.push({
          error,
          timestamp: new Date()
        })
      }
    }
    
    this.commandStats.set(key, current)
  }

  /**
   * Convert technical errors to user-friendly messages


   */
  getUserFriendlyError(error) {
    if (error.message.includes('not found') || error.message.includes('404')) {
      return 'Command not recognized. Type "help" for available commands.'
    }
    
    if (error.message.includes('Invalid arguments') || error.message.includes('400')) {
      return 'Invalid command arguments. Check command usage with "help [command]".'
    }
    
    if (error.message.includes('timeout') || error.message.includes('408')) {
      return 'Command execution timed out. Please try again.'
    }
    
    if (error.message.includes('not available') || error.message.includes('503')) {
      return 'Command service is temporarily unavailable.'
    }
    
    // Default fallback
    return 'Unable to execute command. Please check syntax and try again.'
  }

  /**
   * Get command execution statistics

   */
  getCommandStats() {
    const stats = {
      totalCommands: 0,
      totalExecutions: 0,
      totalSuccesses: 0,
      totalErrors: 0,
      lastExecution: this.lastCommandExecution,
      commandBreakdown: {}
    }
    
    for (const [key, data] of this.commandStats) {
      stats.totalCommands++
      stats.totalExecutions += data.total
      stats.totalSuccesses += data.success
      stats.totalErrors += data.errors
      stats.commandBreakdown[key] = { ...data }
    }
    
    stats.successRate = stats.totalExecutions > 0 ? 
      (stats.totalSuccesses / stats.totalExecutions) * 100 : 0
    
    return stats
  }

  /**
   */
  getStats() {
    const baseStats = super.getStats()
    const commandStats = this.getCommandStats()
    
    return {
      ...baseStats,
      commandOperations: commandStats
    }
  }

  /**
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    const commandStats = this.getCommandStats()
    
    return {
      ...baseHealth,
      commandHealth: {
        hasCommandService: !!this.commandService,
        totalCommands: commandStats.totalCommands,
        successRate: commandStats.successRate,
        recentErrors: commandStats.totalErrors,
        lastExecution: this.lastCommandExecution,
        isHealthy: this.commandService && commandStats.successRate > 80
      }
    }
  }

  /**
   * Get available command types and their status

   */
  getCommandTypeStatus() {
    if (!this.commandService) {
      return { available: false, reason: 'Command service not available' }
    }
    
    try {
      // Test command parsing with dummy input
      const testCommand = this.commandService.parseCommand('help')
      
      return {
        available: true,
        supportedTypes: Object.values(CommandType),
        testResult: testCommand.type
      }
    } catch (error) {
      return {
        available: false,
        reason: error.message
      }
    }
  }

  /**
   */
  dispose() {
    super.dispose()
    this.commandStats.clear()
    this.lastCommandExecution = null
  }
}