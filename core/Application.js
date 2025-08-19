/**
 * Application - Core application architecture
 * Orchestrates all components and manages application lifecycle
 */
import { getStateManager } from './StateManager.js'
// import { getCLIInterface } from './CLIInterface.js' // Disabled - using CLIManager instead
import { createRequestRouter } from './RequestRouter.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import cacheManager from '../core/CacheManager.js'

export class Application {
  constructor(dependencies = {}) {
    // Core components
    this.stateManager = getStateManager()
    // this.cliInterface = getCLIInterface(this.stateManager) // Disabled - using CLIManager instead
    this.cliInterface = null // Set to null to avoid readline conflicts
    this.requestRouter = null // Created during initialization
    
    // Dependencies from legacy system
    this.serviceManager = dependencies.serviceManager
    this.mcpManager = dependencies.mcpManager
    this.intentDetector = dependencies.intentDetector
    this.cache = dependencies.cache
    this.multiProviderTranslator = dependencies.multiProviderTranslator
    this.multiCommandProcessor = dependencies.multiCommandProcessor
    this.commandHandler = dependencies.commandHandler
    
    // Application state
    this.isInitialized = false
    this.isRunning = false
    this.startTime = null
    
    // Event listeners
    this.listeners = new Map()
    
    // Bind context for event handlers
    this.handleUserInput = this.handleUserInput.bind(this)
    this.handleShutdown = this.handleShutdown.bind(this)
  }
  
  /**
   * Initialize the application
   */
  async initialize() {
    if (this.isInitialized) {
      return
    }
    
    logger.info('Initializing core application...')
    this.startTime = Date.now()
    
    try {
      // Initialize CLI interface
      if (this.cliInterface) {
        await this.cliInterface.initialize({
          enableColors: true,
          showCursor: true
        })
      }
      
      // Create request router with dependencies
      this.requestRouter = createRequestRouter(this.stateManager, this.cliInterface, {
        intentDetector: this.intentDetector,
        mcpManager: this.mcpManager,
        commandHandler: this.commandHandler,
        cache: this.cache,
        multiProviderTranslator: this.multiProviderTranslator,
        multiCommandProcessor: this.multiCommandProcessor
      })
      
      // Initialize request router
      await this.requestRouter.initialize()
      
      // Initialize services if available
      if (this.serviceManager) {
        await this.serviceManager.initialize()
      }
      
      // Setup AI provider
      await this.initializeAIProvider()
      
      // Setup state change listeners
      this.setupStateListeners()
      
      // Setup process handlers
      this.setupProcessHandlers()
      
      this.isInitialized = true
      const initTime = Date.now() - this.startTime
      logger.info(`Application initialized in ${initTime}ms`)
      
    } catch (error) {
      logger.error('Application initialization failed:', error)
      throw error
    }
  }
  
  /**
   * Initialize AI provider
   * @private
   */
  async initializeAIProvider() {
    if (!this.serviceManager) {
      throw new Error('Service manager not available for AI initialization')
    }
    
    try {
      // Get AI provider service
      const aiService = this.serviceManager.getAIProviderService()
      if (!aiService) {
        throw new Error('AI provider service not available')
      }
      
      // Get current provider info
      const currentProvider = aiService.getCurrentProvider()
      if (currentProvider && currentProvider.instance) {
        // Update state manager with current provider
        this.stateManager.updateAIProvider({
          instance: currentProvider.instance,
          key: currentProvider.key,
          model: currentProvider.model,
          models: currentProvider.models || []
        })
        
        logger.info(`AI provider initialized: ${currentProvider.key} with model ${currentProvider.model}`)
      } else {
        throw new Error('No AI provider available')
      }
      
    } catch (error) {
      logger.error('AI provider initialization failed:', error)
      throw error
    }
  }
  
  /**
   * Setup state change listeners
   * @private
   */
  setupStateListeners() {
    // Listen for AI provider changes
    this.stateManager.addListener('ai-provider-changed', (data) => {
      logger.debug(`Provider changed: ${data.previous} → ${data.current}`)
      this.emit('provider-changed', data)
    })
    
    // Listen for model changes
    this.stateManager.addListener('model-changed', (data) => {
      logger.debug(`Model changed: ${data.previous} → ${data.current}`)
      this.emit('model-changed', data)
    })
    
    // Listen for context updates
    this.stateManager.addListener('context-updated', (data) => {
      // Show context history dots
      if (this.cliInterface) {
        this.cliInterface.showContextHistory(data.historyLength)
      }
    })
    
    // Listen for context cleared
    this.stateManager.addListener('context-cleared', () => {
      if (this.cliInterface) {
        this.cliInterface.writeWarning('Context history cleared')
      }
    })
  }
  
  /**
   * Setup process signal handlers
   * @private
   */
  setupProcessHandlers() {
    // Handle graceful shutdown
    process.on('SIGINT', this.handleShutdown)
    process.on('SIGTERM', this.handleShutdown)
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error)
      errorHandler.handleError(error, { context: 'uncaught_exception', fatal: true })
      this.shutdown(1)
    })
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection:', reason)
      errorHandler.handleError(reason, { context: 'unhandled_rejection' })
    })
  }
  
  /**
   * Run the main application loop
   */
  async run() {
    if (!this.isInitialized) {
      throw new Error('Application must be initialized before running')
    }
    
    if (this.isRunning) {
      return
    }
    
    this.isRunning = true
    logger.debug('Starting main application loop')
    
    try {
      // Start the CLI interaction loop
      await this.cliInterface.startInteractionLoop(this.handleUserInput)
      
    } catch (error) {
      logger.error('Application loop error:', error)
      throw error
    } finally {
      this.isRunning = false
    }
  }
  
  /**
   * Handle user input
   * @private
   * @param {string} userInput - User input string
   */
  async handleUserInput(userInput) {
    try {
      // Route the request
      const routingResult = await this.requestRouter.routeRequest(userInput)
      
      if (!routingResult.success) {
        this.cliInterface.writeError(routingResult.error)
        return
      }
      
      // Execute the routed action
      await this.executeRoutedAction(routingResult)
      
    } catch (error) {
      logger.error('Input handling error:', error)
      
      if (error.name === 'AbortError') {
        // Request was cancelled, continue normally
        return
      }
      
      // Show error to user
      this.cliInterface.writeError(`Processing error: ${error.message}`)
      
      // Reset state on error
      this.stateManager.clearRequestState()
    }
  }
  
  /**
   * Execute action based on routing result
   * @private
   * @param {Object} routingResult - Result from request router
   */
  async executeRoutedAction(routingResult) {
    const { action, result, input, command, metadata } = routingResult
    
    switch (action) {
      case 'execute_system_command':
        // System command was already executed by router
        if (result.result) {
          this.cliInterface.writeOutput(result.result)
        }
        break
        
      case 'return_cached_result':
      case 'return_formatted_result':
      case 'return_direct_response':
        // Direct result to display
        this.cliInterface.writeOutput(result)
        break
        
      case 'process_translation':
      case 'process_instruction':
      case 'process_chat':
      case 'process_enhanced_input':
        // These need AI processing
        await this.processAIRequest(input, command, metadata)
        break
        
      case 'process_multi_provider':
        await this.processMultiProvider(command)
        break
        
      case 'process_multi_model':
        await this.processMultiModel(command)
        break
        
      default:
        throw new Error(`Unknown action: ${action}`)
    }
  }
  
  /**
   * Process AI request
   * @private
   * @param {string} input - Processed input
   * @param {Object} command - Command object (if any)
   * @param {Object} metadata - Request metadata
   */
  async processAIRequest(input, command = null, metadata = {}) {
    // Set processing state
    const controller = new AbortController()
    this.stateManager.setProcessingRequest(true, controller)
    
    try {
      // Get AI state
      const aiState = this.stateManager.getAIState()
      if (!aiState.provider) {
        throw new Error('No AI provider available')
      }
      
      // Prepare messages
      const messages = this.prepareMessages(input, command)
      
      // Show processing indicator
      const spinner = this.cliInterface.showSpinner('Processing')
      
      try {
        // Call AI provider
        const stream = await aiState.provider.createChatCompletion(
          aiState.model, 
          messages, 
          {
            stream: true,
            signal: controller.signal
          }
        )
        
        // Hide spinner
        this.cliInterface.hideSpinner(spinner)
        
        // Process stream
        await this.processAIStream(stream, input, command)
        
      } catch (error) {
        this.cliInterface.hideSpinner(spinner)
        throw error
      }
      
    } finally {
      // Clear processing state
      this.stateManager.clearRequestState()
    }
  }
  
  /**
   * Prepare messages for AI request
   * @private
   * @param {string} input - User input
   * @param {Object} command - Command object
   * @returns {Array} Messages array
   */
  prepareMessages(input, command) {
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
   * Process AI response stream
   * @private
   * @param {Object} stream - AI response stream
   * @param {string} originalInput - Original user input
   * @param {Object} command - Command object
   */
  async processAIStream(stream, originalInput, command) {
    this.stateManager.setTypingResponse(true)
    
    let response = ''
    
    try {
      for await (const chunk of stream) {
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
          const content = chunk.choices[0].delta.content
          if (content) {
            response += content
            process.stdout.write(content)
          }
        }
      }
      
      // Add to context (unless it's a translation)
      if (!command || !command.isTranslation) {
        this.stateManager.addToContext('user', originalInput)
        this.stateManager.addToContext('assistant', response)
      }
      
      // Cache results using CacheManager
      if (command) {
        const cacheDecision = cacheManager.shouldCache(command, null, false)
        if (cacheDecision.shouldStore) {
          const cacheKey = cacheManager.generateCacheKey(
            command.hasUrl ? command.originalInput : command.fullInstruction, 
            command
          )
          await cacheManager.setCache(cacheKey, response, cacheDecision)
        }
      }
      
    } finally {
      this.stateManager.setTypingResponse(false)
      console.log() // New line after response
    }
  }
  
  /**
   * Process multi-provider request
   * @private
   */
  async processMultiProvider(command) {
    if (!this.multiProviderTranslator) {
      throw new Error('Multi-provider translator not available')
    }
    
    const controller = this.stateManager.getCurrentRequestController()
    
    const result = await this.multiProviderTranslator.translateMultiple(
      command.commandType,
      command.instruction,
      command.targetContent,
      controller.signal,
      command.models
    )
    
    this.cliInterface.writeOutput(result)
  }
  
  /**
   * Process multi-model request
   * @private
   */
  async processMultiModel(command) {
    if (!this.multiCommandProcessor) {
      throw new Error('Multi-command processor not available')
    }
    
    const result = await this.multiCommandProcessor.process(command)
    this.cliInterface.writeOutput(result)
  }
  
  /**
   * Handle shutdown signal
   * @private
   */
  handleShutdown() {
    logger.info('Received shutdown signal')
    this.shutdown(0)
  }
  
  /**
   * Shutdown the application
   * @param {number} exitCode - Exit code
   */
  async shutdown(exitCode = 0) {
    if (!this.isRunning && !this.isInitialized) {
      process.exit(exitCode)
      return
    }
    
    logger.info('Shutting down application...')
    
    try {
      // Stop main loop
      this.isRunning = false
      
      // Cleanup CLI interface
      if (this.cliInterface) {
        this.cliInterface.cleanup()
      }
      
      // Cleanup service manager
      if (this.serviceManager) {
        await this.serviceManager.dispose()
      }
      
      // Reset state
      this.stateManager.reset()
      
      this.isInitialized = false
      
      logger.info('Application shutdown complete')
      
    } catch (error) {
      logger.error('Error during shutdown:', error)
    } finally {
      process.exit(exitCode)
    }
  }
  
  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} listener - Event listener
   */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(listener)
  }
  
  /**
   * Remove event listener
   * @param {string} event - Event name
   * @param {Function} listener - Event listener
   */
  off(event, listener) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(listener)
    }
  }
  
  /**
   * Emit event
   * @private
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        try {
          listener(data)
        } catch (error) {
          logger.error(`Event listener error for ${event}:`, error)
        }
      })
    }
  }
  
  /**
   * Get application status
   * @returns {Object} Application status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      stateManager: this.stateManager.getStateSnapshot(),
      cliInterface: this.cliInterface.getTerminalState(),
      requestRouter: this.requestRouter ? this.requestRouter.getRoutingStats() : null
    }
  }
}

/**
 * Create application instance with dependencies
 * @param {Object} dependencies - Application dependencies
 * @returns {Application} Application instance
 */
export function createApplication(dependencies = {}) {
  return new Application(dependencies)
}