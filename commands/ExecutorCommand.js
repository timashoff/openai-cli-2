/**
 * CommandExecutor - Central command execution engine
 * Orchestrates execution of all command types through UnifiedCommandManager
 * Integrated with unified routing system for consistent command handling
 */
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { databaseCommandService } from '../services/DatabaseCommandService.js'

export class CommandExecutor {
  constructor(dependencies = {}) {
    // Core dependencies
    this.stateManager = dependencies.stateManager
    this.cliInterface = dependencies.cliInterface
    this.serviceManager = dependencies.serviceManager
    this.requestRouter = dependencies.requestRouter
    this.app = dependencies.app // Reference to main application instance
    
    // Command handlers
    this.systemCommands = dependencies.systemCommands
    this.aiCommands = dependencies.aiCommands
    this.commandEditor = dependencies.commandEditor
    
    // Legacy dependencies (passed directly)
    this.cache = dependencies.cache
    this.mcpManager = dependencies.mcpManager
    this.intentDetector = dependencies.intentDetector
    this.multiProviderTranslator = dependencies.multiProviderTranslator
    this.multiCommandProcessor = dependencies.multiCommandProcessor
    
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
   * Execute user input - main entry point used by app.js
   */
  async executeUserInput(userInput) {
    const result = await this.execute(userInput)
    
    // Display result if needed
    if (result.success && result.result) {
      // Handle different result formats
      if (result.result.displayResult) {
        // Legacy format with displayResult
        this.cliInterface.writeOutput(result.result.displayResult)
      } else if (typeof result.result === 'string') {
        // Direct string result (e.g., from UnifiedCommandManager)
        this.cliInterface.writeOutput(result.result)
      } else if (result.result.result && typeof result.result.result === 'string') {
        // Unified command result format
        this.cliInterface.writeOutput(result.result.result)
      }
    }
    
    // If execution failed, show user-friendly error message
    if (!result.success) {
      // Check if it's a user input error that should show helpful message
      if (result.error && result.error.includes('Command') && result.error.includes('requires additional input')) {
        this.cliInterface.writeError(result.error)
        return // Don't throw for user guidance errors
      }
      
      // For other errors, provide user-friendly message instead of stack trace
      const userFriendlyMessage = this.getUserFriendlyErrorMessage(result.error)
      this.cliInterface.writeError(userFriendlyMessage)
      return
    }
  }

  /**
   * Execute user input through appropriate command pipeline
   */
  async execute(userInput) {
    const executionId = this.generateExecutionId()
    const startTime = Date.now()
    
    logger.debug(`CommandExecutor: Starting execution ${executionId} for input: "${userInput.substring(0, 50)}..."`)
    
    try {
      // Validate and sanitize input
      const cleanInput = await this.validateAndSanitizeInput(userInput)
      
      // Try unified command system first
      const unifiedResult = await this.tryUnifiedCommand(cleanInput)
      if (unifiedResult) {
        this.recordExecution(executionId, startTime, unifiedResult.success)
        
        return {
          success: unifiedResult.success,
          executionId,
          classification: 'unified',
          result: unifiedResult.result,
          executionTime: Date.now() - startTime,
          source: 'UnifiedCommandManager'
        }
      }
      
      // Fallback: Use legacy classification and routing
      const classification = await this.classifyInput(cleanInput)
      const result = await this.executeClassifiedCommand(classification, cleanInput)
      
      // Record successful execution
      this.recordExecution(executionId, startTime, true)
      
      return {
        success: true,
        executionId,
        classification: classification.type,
        result,
        executionTime: Date.now() - startTime,
        source: 'legacy'
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
   * Legacy method - no longer used after architecture refactor
   */
  async tryUnifiedCommand(input) {
    return null // UnifiedCommandManager replaced by config-based system
  }
  
  /**
   * Validate and sanitize user input
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
   */
  async classifyInput(input) {
    const words = input.trim().split(' ')
    const commandName = words[0].toLowerCase()
    const args = words.slice(1)
    
    console.log(`[DEBUG] Classifying input: "${input}" -> command: "${commandName}"`)
    
    // Check for system commands
    if (this.systemCommandPatterns.includes(commandName)) {
      console.log(`[DEBUG] Classified as SYSTEM command`)
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
    
    // CRITICAL FIX: Check SQLite database BEFORE defaulting to CHAT
    // Business Logic: Only real database commands should be classified as INSTRUCTION
    const command = databaseCommandService.findByKey(commandName)
    
    if (command) {
      console.log(`[DEBUG] Found command "${commandName}" in SQLite database (ID: ${command.id})`)
      
      // CRITICAL FIX: Check for missing arguments for template commands
      if (args.length === 0) {
        // This is a template command without content - show helpful message
        console.log(`[DEBUG] Command "${commandName}" is a template and requires arguments.`)
        
        // Instead of throwing error, provide helpful guidance
        const usage = this.getCommandUsage(command)
        const errorMessage = `${color.yellow}Command "${commandName}" requires additional input.${color.reset}\n\n${usage}\n\nPlease try again with the required arguments.`
        
        // Create a user-friendly operational error instead of throwing
        const userError = new Error(errorMessage)
        userError.isOperational = true
        userError.isUserInputError = true
        userError.requiresPrompt = true
        
        throw userError
      }

      // Use RequestRouter for full command processing
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
      
      // Fallback: Simple instruction classification
      return {
        type: this.COMMAND_TYPES.INSTRUCTION,
        commandName,
        args,
        originalInput: input,
        isCommand: true,
        databaseCommand: command
      }
    }
    
    // BUSINESS LOGIC: If command NOT found in SQLite DB → it's CHAT, not a command!
    console.log(`[DEBUG] Command "${commandName}" NOT found in SQLite DB → Classified as CHAT`)
    return {
      type: this.COMMAND_TYPES.INSTRUCTION,
      commandName: null,
      originalInput: input,
      isChat: true // This will be processed as chat, not cached as command
    }
  }
  
  /**
   * Execute command based on classification
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
   */
  async executeSystemCommand(classification) {
    const { commandName, args } = classification
    
    // Handle built-in system commands through RequestRouter
    const builtinCommands = ['help', 'h', 'exit', 'q']
    if (builtinCommands.includes(commandName)) {
      console.log(`[DEBUG] Executing built-in system command: ${commandName}`)
      
      // Route through RequestRouter for full processing
      const routingResult = await this.requestRouter.routeRequest(classification.originalInput || commandName)
      console.log(`[DEBUG] Routing result:`, { success: routingResult.success, action: routingResult.action })
      
      if (routingResult.success) {
        const result = await this.executeRoutedInstruction(routingResult)
        console.log(`[DEBUG] Executed result:`, { type: result.type, hasDisplayResult: !!result.displayResult })
        return result
      } else {
        throw new Error(routingResult.error)
      }
    }
    
    // Handle legacy system commands through systemCommands manager
    if (!this.systemCommands || !this.systemCommands.hasCommand(commandName)) {
      throw new Error(`System command not found: ${commandName}`)
    }
    
    logger.debug(`Executing legacy system command: ${commandName}`)
    
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

   */
  async executeChatInstruction(input) {
    return await this.processAIRequest(input, null, {})
  }
  
  /**
   * Process AI request using RequestRouter



   */
  async processAIRequest(input, command = null, metadata = {}) {
    // Use RequestRouter for complete business logic
    if (!this.requestRouter) {
      throw new Error('Request router not available')
    }
    
    // Import required dependencies for RequestRouter
    const { StreamProcessor } = await import('../utils/stream-processor.js')
    const { configManager } = await import('../config/config-manager.js')
    
    // CRITICAL FIX: Get the AbortController from the state manager
    const controller = this.stateManager.getCurrentRequestController()
    if (!controller) {
      logger.warn('CommandExecutor: AbortController not found in state manager for AI request.')
    }

    // Gather all dependencies needed by RequestRouter.processAIInput
    const dependencies = {
      serviceManager: this.serviceManager,
      cliInterface: this.cliInterface,
      cache: this.cache,
      mcpManager: this.mcpManager,
      intentDetector: this.intentDetector,
      multiProviderTranslator: this.multiProviderTranslator,
      StreamProcessor,
      configManager,
      abortController: controller // Pass the controller
    }
    
    // Use RequestRouter's processAIInput for complete business logic
    await this.requestRouter.processAIInput(input, dependencies)
    
    return {
      type: 'instruction',
      action: 'ai_processing_completed',
      result: 'Processing completed via RequestRouter',
      displayResult: null, // RequestRouter handles display
      command: command && command.commandKey || 'chat'
    }
  }
  
  
  /**
   * Process multi-provider request
   */
  async processMultiProvider(command) {
    if (!this.multiProviderTranslator) {
      throw new Error('Multi-provider translator not available')
    }
    
    const controller = this.stateManager.getCurrentRequestController()
    
    const result = await this.multiProviderTranslator.translateMultiple(
      command.commandType,
      command.instruction,
      command.userInput,
      controller.signal,
      command.models
    )
    
    return {
      type: 'instruction',
      action: 'multi_provider_completed',
      result,
      displayResult: result
    }
  }
  
  /**
   * Process multi-model request
   */
  async processMultiModel(command) {
    if (!this.multiCommandProcessor) {
      throw new Error('Multi-command processor not available')
    }
    
    const controller = this.stateManager.getCurrentRequestController()
    
    try {
      const result = await this.multiCommandProcessor.executeMultiple({
        instruction: command.content,
        signal: controller ? controller.signal : null,
        models: command.models,
        defaultModel: null,
        onComplete: null
      })
      
      return {
        type: 'instruction',
        action: 'multi_model_completed',
        result,
        displayResult: result
      }
    } catch (error) {
      throw new Error(`Multi-model processing failed: ${error.message}`)
    }
  }
  
  /**
   * Prepare messages for AI request



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
   * Get command usage information


   */
  getCommandUsage(command) {
    const commandExamples = {
      'kg': 'kg <word or phrase to translate>',
      'aa': 'aa <text to translate to English>',
      'rr': 'rr <text to translate to Russian>',
      'cc': 'cc <text to translate to Chinese>',
      'сс': 'сс <text to translate to Chinese>',
      'hsk': 'hsk <Chinese text for HSK analysis>'
    }
    
    const example = commandExamples[command.key] || `${command.key} <your input here>`
    
    return `${color.cyan}Usage:${color.reset} ${example}\n${color.cyan}Description:${color.reset} ${command.instruction || 'No description available'}`
  }

  /**
   * Generate unique execution ID

   */
  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  /**
   * Record execution statistics




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
   * Get user-friendly error message


   */
  getUserFriendlyErrorMessage(error) {
    // Common error patterns and their user-friendly equivalents
    const errorMappings = {
      'Network error': 'Connection failed. Please check your internet connection.',
      'Invalid API key': 'API authentication failed. Please check your API key configuration.',
      'Rate limit': 'Too many requests. Please wait a moment and try again.',
      'Model not found': 'The selected AI model is not available. Try switching to a different model.',
      'Input too long': 'Your input is too long. Please shorten it and try again.',
      'Timeout': 'Request timed out. Please try again.',
      'Permission denied': 'Access denied. Please check your permissions.'
    }
    
    // Find matching pattern
    for (const [pattern, friendlyMessage] of Object.entries(errorMappings)) {
      if (error && error.toLowerCase().includes(pattern.toLowerCase())) {
        return friendlyMessage
      }
    }
    
    // Default user-friendly message for unrecognized errors
    return `Something went wrong: ${error || 'Unknown error'}. Please try again or contact support if the problem persists.`
  }

  /**
   * Get executor status and configuration

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
        commandEditor: !!this.commandEditor,
        cache: !!this.cache,
        mcpManager: !!this.mcpManager,
        intentDetector: !!this.intentDetector,
        multiProviderTranslator: !!this.multiProviderTranslator
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


 */
export function createCommandExecutor(dependencies = {}) {
  return new CommandExecutor(dependencies)
}