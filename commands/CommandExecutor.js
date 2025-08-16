/**
 * CommandExecutor - Central command execution engine
 * Orchestrates execution of all command types: system, AI, and instruction commands
 */
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'

export class CommandExecutor {
  constructor(dependencies = {}) {
    // Core dependencies
    this.stateManager = dependencies.stateManager
    this.cliInterface = dependencies.cliInterface
    this.serviceManager = dependencies.serviceManager
    this.requestRouter = dependencies.requestRouter
    
    // Command handlers
    this.systemCommands = dependencies.systemCommands
    this.aiCommands = dependencies.aiCommands
    this.commandEditor = dependencies.commandEditor
    
    // Execution statistics
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      executionTimes: []
    }
    
    // Command type mapping
    this.COMMAND_TYPES = {
      SYSTEM: 'system',
      AI: 'ai',
      INSTRUCTION: 'instruction',
      HELP: 'help',
      CUSTOM: 'custom'
    }
  }
  
  /**
   * Initialize the command executor
   */
  async initialize() {
    logger.debug('Initializing CommandExecutor')
    
    // Setup command type detection patterns
    this.setupCommandPatterns()
    
    logger.debug('CommandExecutor initialized')
  }
  
  /**
   * Setup command detection patterns
   * @private
   */
  setupCommandPatterns() {
    // System commands patterns
    this.systemCommandPatterns = ['help', 'exit', 'q']
    
    // AI commands patterns  
    this.aiCommandPatterns = ['provider', 'p', 'model', 'm', 'web', 'w']
    
    // Special commands
    this.specialCommandPatterns = ['cmd', 'кмд']
  }
  
  /**
   * Execute user input through appropriate command pipeline
   * @param {string} userInput - Raw user input
   * @returns {Promise<Object>} Execution result
   */
  async execute(userInput) {
    const executionId = this.generateExecutionId()
    const startTime = Date.now()
    
    logger.debug(`CommandExecutor: Starting execution ${executionId} for input: "${userInput.substring(0, 50)}..."`)
    
    try {
      // Validate and sanitize input
      const cleanInput = await this.validateAndSanitizeInput(userInput)
      
      // Classify and route the command
      const classification = await this.classifyInput(cleanInput)
      
      // Execute based on classification
      const result = await this.executeClassifiedCommand(classification, cleanInput)
      
      // Record successful execution
      this.recordExecution(executionId, startTime, true)
      
      return {
        success: true,
        executionId,
        classification: classification.type,
        result,
        executionTime: Date.now() - startTime
      }
      
    } catch (error) {
      // Record failed execution
      this.recordExecution(executionId, startTime, false, error)
      
      logger.error(`CommandExecutor: Execution ${executionId} failed:`, error)
      
      return {
        success: false,
        executionId,
        error: error.message,
        executionTime: Date.now() - startTime
      }
    }
  }
  
  /**
   * Validate and sanitize user input
   * @private
   * @param {string} input - Raw user input
   * @returns {Promise<string>} Clean input
   */
  async validateAndSanitizeInput(input) {
    // Sanitize the input
    const sanitized = sanitizeString(input)
    
    // Validate length
    const maxLength = configManager.get('maxInputLength')
    if (sanitized.length > maxLength) {
      throw new Error(`Input too long (max ${maxLength} characters)`)
    }
    
    // Additional validation
    validateString(sanitized, 'user input', true)
    
    return sanitized.trim()
  }
  
  /**
   * Classify user input to determine command type
   * @private
   * @param {string} input - Clean user input
   * @returns {Promise<Object>} Classification result
   */
  async classifyInput(input) {
    const words = input.trim().split(' ')
    const commandName = words[0].toLowerCase()
    const args = words.slice(1)
    
    // Check for system commands
    if (this.systemCommandPatterns.includes(commandName)) {
      return {
        type: this.COMMAND_TYPES.SYSTEM,
        commandName,
        args,
        originalInput: input
      }
    }
    
    // Check for AI commands
    if (this.aiCommandPatterns.includes(commandName)) {
      return {
        type: this.COMMAND_TYPES.AI,
        commandName,
        args,
        originalInput: input
      }
    }
    
    // Check for special commands (cmd)
    if (this.specialCommandPatterns.includes(commandName)) {
      return {
        type: this.COMMAND_TYPES.CUSTOM,
        commandName,
        args,
        originalInput: input
      }
    }
    
    // Check if this is an instruction command using RequestRouter
    if (this.requestRouter) {
      const routingResult = await this.requestRouter.routeRequest(input)
      
      if (routingResult.success && routingResult.context.command) {
        return {
          type: this.COMMAND_TYPES.INSTRUCTION,
          commandName: routingResult.context.command.commandKey,
          command: routingResult.context.command,
          routingResult,
          originalInput: input
        }
      }
    }
    
    // Default to instruction processing
    return {
      type: this.COMMAND_TYPES.INSTRUCTION,
      commandName: null,
      originalInput: input,
      isChat: true
    }
  }
  
  /**
   * Execute command based on classification
   * @private
   * @param {Object} classification - Command classification
   * @param {string} input - Clean input
   * @returns {Promise<any>} Execution result
   */
  async executeClassifiedCommand(classification, input) {
    switch (classification.type) {
      case this.COMMAND_TYPES.SYSTEM:
        return await this.executeSystemCommand(classification)
        
      case this.COMMAND_TYPES.AI:
        return await this.executeAICommand(classification)
        
      case this.COMMAND_TYPES.CUSTOM:
        return await this.executeCustomCommand(classification)
        
      case this.COMMAND_TYPES.INSTRUCTION:
        return await this.executeInstructionCommand(classification, input)
        
      default:
        throw new Error(`Unknown command type: ${classification.type}`)
    }
  }
  
  /**
   * Execute system command
   * @private
   * @param {Object} classification - Command classification
   */
  async executeSystemCommand(classification) {
    const { commandName, args } = classification
    
    if (!this.systemCommands || !this.systemCommands.hasCommand(commandName)) {
      throw new Error(`System command not found: ${commandName}`)
    }
    
    logger.debug(`Executing system command: ${commandName}`)
    
    const result = await this.systemCommands.executeCommand(commandName, args, {
      app: this,
      stateManager: this.stateManager
    })
    
    return {
      type: 'system',
      command: commandName,
      result,
      displayResult: result
    }
  }
  
  /**
   * Execute AI command (provider, model)
   * @private
   * @param {Object} classification - Command classification
   */
  async executeAICommand(classification) {
    const { commandName, args } = classification
    
    if (!this.aiCommands || !this.aiCommands.hasCommand(commandName)) {
      throw new Error(`AI command not found: ${commandName}`)
    }
    
    logger.debug(`Executing AI command: ${commandName}`)
    
    const result = await this.aiCommands.executeCommand(commandName, args, {
      app: this,
      stateManager: this.stateManager
    })
    
    return {
      type: 'ai',
      command: commandName,
      result,
      displayResult: result
    }
  }
  
  /**
   * Execute custom command (cmd)
   * @private
   * @param {Object} classification - Command classification
   */
  async executeCustomCommand(classification) {
    const { commandName } = classification
    
    if (commandName === 'cmd' || commandName === 'кмд') {
      if (!this.commandEditor) {
        throw new Error('Command editor not available')
      }
      
      logger.debug('Opening command editor')
      await this.commandEditor.showCommandMenu()
      
      return {
        type: 'custom',
        command: commandName,
        result: 'Command editor opened',
        displayResult: null // No output needed
      }
    }
    
    throw new Error(`Unknown custom command: ${commandName}`)
  }
  
  /**
   * Execute instruction command (translation, chat, etc.)
   * @private
   * @param {Object} classification - Command classification
   * @param {string} input - Clean input
   */
  async executeInstructionCommand(classification, input) {
    logger.debug(`Executing instruction command: ${classification.commandName || 'chat'}`)
    
    // If we have a routing result from RequestRouter, use it
    if (classification.routingResult) {
      return await this.executeRoutedInstruction(classification.routingResult)
    }
    
    // Fallback to direct AI processing for chat
    return await this.executeChatInstruction(input)
  }
  
  /**
   * Execute routed instruction via RequestRouter
   * @private
   * @param {Object} routingResult - Result from RequestRouter
   */
  async executeRoutedInstruction(routingResult) {
    const { action, result, input, command, metadata } = routingResult
    
    // Handle different routing actions
    switch (action) {
      case 'return_cached_result':
      case 'return_formatted_result':
      case 'return_direct_response':
        return {
          type: 'instruction',
          action,
          result,
          displayResult: result,
          fromCache: action.includes('cached')
        }
        
      case 'process_translation':
      case 'process_instruction':
      case 'process_chat':
      case 'process_enhanced_input':
        return await this.processAIRequest(input, command, metadata)
        
      case 'process_multi_provider':
        return await this.processMultiProvider(command)
        
      case 'process_multi_model':
        return await this.processMultiModel(command)
        
      default:
        throw new Error(`Unknown routing action: ${action}`)
    }
  }
  
  /**
   * Execute chat instruction (direct AI processing)
   * @private
   * @param {string} input - User input
   */
  async executeChatInstruction(input) {
    return await this.processAIRequest(input, null, {})
  }
  
  /**
   * Process AI request
   * @private
   * @param {string} input - Processed input
   * @param {Object} command - Command object (if any)
   * @param {Object} metadata - Request metadata
   */
  async processAIRequest(input, command = null, metadata = {}) {
    // Get AI service from service manager
    if (!this.serviceManager) {
      throw new Error('Service manager not available')
    }
    
    const aiService = this.serviceManager.getAIProviderService()
    if (!aiService) {
      throw new Error('AI provider service not available')
    }
    
    // Prepare messages
    const messages = this.prepareAIMessages(input, command)
    
    // Set processing state
    const controller = new AbortController()
    this.stateManager.setProcessingRequest(true, controller)
    
    try {
      // Show processing indicator
      const spinner = this.cliInterface.showSpinner('Processing AI request')
      
      // Create chat completion
      const response = await this.serviceManager.createChatCompletion(messages, {
        stream: false, // Simplified for now
        signal: controller.signal
      })
      
      // Hide spinner
      this.cliInterface.hideSpinner(spinner)
      
      // Handle context for non-translation commands
      if (!command || !command.isTranslation) {
        this.stateManager.addToContext('user', input)
        this.stateManager.addToContext('assistant', response)
      }
      
      return {
        type: 'instruction',
        action: 'ai_response',
        result: response,
        displayResult: response,
        command: command?.commandKey || 'chat'
      }
      
    } finally {
      // Clear processing state
      this.stateManager.clearRequestState()
    }
  }
  
  /**
   * Process multi-provider request
   * @private
   */
  async processMultiProvider(command) {
    // TODO: Integrate with multi-provider translator
    throw new Error('Multi-provider processing not yet implemented in CommandExecutor')
  }
  
  /**
   * Process multi-model request
   * @private
   */
  async processMultiModel(command) {
    // TODO: Integrate with multi-command processor
    throw new Error('Multi-model processing not yet implemented in CommandExecutor')
  }
  
  /**
   * Prepare messages for AI request
   * @private
   * @param {string} input - User input
   * @param {Object} command - Command object
   * @returns {Array} Messages array
   */
  prepareAIMessages(input, command) {
    const contextHistory = this.stateManager.getContextHistory()
    
    // For translation commands, don't use context
    if (command && command.isTranslation) {
      return [{ role: 'user', content: input }]
    }
    
    // For other commands, include context
    const messages = contextHistory.map(({ role, content }) => ({ role, content }))
    messages.push({ role: 'user', content: input })
    
    return messages
  }
  
  /**
   * Generate unique execution ID
   * @private
   * @returns {string} Execution ID
   */
  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  /**
   * Record execution statistics
   * @private
   * @param {string} executionId - Execution ID
   * @param {number} startTime - Start timestamp
   * @param {boolean} success - Whether execution succeeded
   * @param {Error} error - Error object (if failed)
   */
  recordExecution(executionId, startTime, success, error = null) {
    const executionTime = Date.now() - startTime
    
    this.stats.totalExecutions++
    if (success) {
      this.stats.successfulExecutions++
    } else {
      this.stats.failedExecutions++
    }
    
    this.stats.executionTimes.push(executionTime)
    
    // Keep only last 100 execution times
    if (this.stats.executionTimes.length > 100) {
      this.stats.executionTimes = this.stats.executionTimes.slice(-100)
    }
    
    logger.debug(`CommandExecutor: Execution ${executionId} recorded - ${success ? 'SUCCESS' : 'FAILED'} (${executionTime}ms)`)
  }
  
  /**
   * Get execution statistics
   * @returns {Object} Execution statistics
   */
  getExecutionStats() {
    const avgExecutionTime = this.stats.executionTimes.length > 0 
      ? this.stats.executionTimes.reduce((a, b) => a + b, 0) / this.stats.executionTimes.length 
      : 0
    
    return {
      ...this.stats,
      averageExecutionTime: Math.round(avgExecutionTime),
      successRate: this.stats.totalExecutions > 0 
        ? (this.stats.successfulExecutions / this.stats.totalExecutions * 100).toFixed(2) + '%'
        : '0%'
    }
  }
  
  /**
   * Reset execution statistics
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      executionTimes: []
    }
    
    logger.debug('CommandExecutor: Statistics reset')
  }
  
  /**
   * Get executor status and configuration
   * @returns {Object} Executor status
   */
  getStatus() {
    return {
      initialized: !!this.stateManager,
      dependencies: {
        stateManager: !!this.stateManager,
        cliInterface: !!this.cliInterface,
        serviceManager: !!this.serviceManager,
        requestRouter: !!this.requestRouter,
        systemCommands: !!this.systemCommands,
        aiCommands: !!this.aiCommands,
        commandEditor: !!this.commandEditor
      },
      commandTypes: this.COMMAND_TYPES,
      patterns: {
        system: this.systemCommandPatterns,
        ai: this.aiCommandPatterns,
        special: this.specialCommandPatterns
      },
      stats: this.getExecutionStats()
    }
  }
}

/**
 * Create CommandExecutor instance with dependencies
 * @param {Object} dependencies - Required dependencies
 * @returns {CommandExecutor} CommandExecutor instance
 */
export function createCommandExecutor(dependencies = {}) {
  return new CommandExecutor(dependencies)
}