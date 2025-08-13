#!/usr/bin/env node

import { Application } from '../utils/application.js'
import { CommandManager } from '../utils/command-manager.js'
import { rl } from '../utils/index.js'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getClipboardContent, openInBrowser, getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { createProvider } from '../utils/provider-factory.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { createInteractiveMenu } from '../utils/interactive_menu.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { SYS_INSTRUCTIONS } from '../config/instructions.js'
import { migrateInstructionsToDatabase, getInstructionsFromDatabase } from '../utils/migration.js'
import { CommandEditor } from '../utils/command-editor.js'
import cache from '../utils/cache.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import readline from 'node:readline'
import { mcpManager } from '../utils/mcp-manager.js'
import { intentDetector } from '../utils/intent-detector.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { readFile } from 'node:fs/promises'
import { multiProviderTranslator } from '../utils/multi-provider-translator.js'
import { fileManager } from '../utils/file-manager.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'

// Handler Chain imports
import { HandlerChainFactory } from '../handlers/handler-chain-factory.js'
import { DIContainer } from '../utils/di-container.js'
import { EventBus } from '../utils/event-bus.js'
import { ServicesAdapter } from '../utils/services-adapter.js'
import { SimpleCommandHandler } from '../handlers/simple-command-handler.js'
import { ServiceManager, getServiceManager } from '../services/service-manager.js'


/**
 * Enhanced Application class with AI functionality
 */
class AIApplication extends Application {
  constructor() {
    super()
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
    
    // Use separate command manager to avoid conflicts
    this.aiCommands = new CommandManager()
    
    // Track operation state
    this.isProcessingRequest = false
    this.isTypingResponse = false
    this.currentRequestController = null
    this.currentSpinnerInterval = null
    this.currentStreamProcessor = null
    this.shouldReturnToPrompt = false
    this.isRetryingProvider = false
    
    // Initialize command editor
    this.commandEditor = new CommandEditor(this)
    
    // Initialize simple command handler for testing
    this.simpleCommandHandler = new SimpleCommandHandler(this)
    
    // Initialize service manager for modern architecture
    this.serviceManager = getServiceManager(this)
    
    // Initialize handler chain system - DISABLED while studying architecture
    // this.initializeHandlerChain()
    
    // Setup global cleanup handlers
    this.setupCleanupHandlers()
  }

  /**
   * Initialize the handler chain system
   * @private
   */
  initializeHandlerChain() {
    try {
      // Create event bus for handler communication
      this.eventBus = new EventBus()
      
      // Create dependencies container for handlers
      const handlerDependencies = {
        // Event system
        eventBus: this.eventBus,
        
        // Logging
        logger,
        log: (level, message) => logger.log(level, message),
        
        // Error handling
        errorBoundary: null, // Will be initialized later when ErrorBoundary is available
        
        // Services (using adapter pattern for compatibility)
        streamingService: ServicesAdapter.createStreamingService(this),
        providerService: ServicesAdapter.createProviderService(this),
        commandService: ServicesAdapter.createCommandService(this),
        mcpService: mcpManager, // Use existing MCP manager
        
        // Cache and storage
        cache,
        
        // Existing utilities
        multiProviderTranslator,
        multiCommandProcessor,
        fileManager,
        
        // Application context
        app: this,
        services: {
          app: this,
          contextHistory: this.state.contextHistory,
          addToContext: this.addToContext.bind(this),
          userSession: {} // Placeholder for user session data
        }
      }
      
      // Create handler chain
      this.requestHandlers = HandlerChainFactory.createRequestChain(handlerDependencies)
      
      // Validate the chain
      const validation = HandlerChainFactory.validateChain(this.requestHandlers)
      if (!validation.valid) {
        logger.warn(`Handler chain validation failed: ${validation.error}`)
      } else {
        logger.info(`Handler chain initialized with ${validation.handlerCount} handlers`)
      }
      
      // Setup event listeners for handler communication
      this.setupHandlerEvents()
      
    } catch (error) {
      logger.error(`Failed to initialize handler chain: ${error.message}`)
      // Fallback to legacy processing
      this.requestHandlers = null
    }
  }

  /**
   * Setup event listeners for handler events
   * @private
   */
  setupHandlerEvents() {
    if (!this.eventBus) return
    
    // Listen to important handler events
    this.eventBus.on('cache:hit', (data) => {
      logger.debug(`Cache hit: ${data.type} (${data.size} bytes)`)
    })
    
    this.eventBus.on('command:executed', (data) => {
      logger.debug(`Command executed: ${data.type}:${data.name} (${data.executionTime}ms)`)
    })
    
    this.eventBus.on('mcp:enhanced-input', (data) => {
      logger.debug(`MCP enhanced input: ${data.type} (${data.originalLength} -> ${data.enhancedLength})`)
    })
    
    this.eventBus.on('stream:processed', (data) => {
      logger.debug(`Stream processed: ${data.strategy} (${data.inputLength} chars)`)
    })
    
    // Handle system events
    this.eventBus.on('system:exit-requested', () => {
      logger.info('System exit requested via handler chain')
    })
  }
  
  /**
   * Setup process cleanup handlers
   */
  setupCleanupHandlers() {
    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.removeAllListeners('keypress')
      process.stdout.write('\x1B[?25h') // Show cursor
    }
    
    // Global keypress handler for the entire application
    const globalKeyPressHandler = (str, key) => {
      if (key && key.name === 'escape') {
        if (this.isProcessingRequest && this.currentRequestController) {
          // Stop spinner immediately
          if (this.currentSpinnerInterval) {
            clearInterval(this.currentSpinnerInterval)
            this.currentSpinnerInterval = null
          }
          
          clearTerminalLine()
          
          // Force abort and cleanup
          this.currentRequestController.abort()
          this.isProcessingRequest = false
          
          // Force terminate stream processing if active
          if (this.currentStreamProcessor) {
            this.currentStreamProcessor.forceTerminate()
          }
          
          // Force show cursor and ensure we're ready for input
          process.stdout.write('\x1B[?25h')
          
        } else if (this.isTypingResponse) {
          // Don't clear the line - just add a newline to preserve streamed text
          console.log() // Add a clean newline
          this.isTypingResponse = false
          this.shouldReturnToPrompt = true
          
          // Force immediate return to input prompt
          process.stdout.write('\x1B[?25h') // Show cursor
        }
      }
    }
    
    // Setup global keypress handling once
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.on('keypress', globalKeyPressHandler)
    
    process.on('SIGINT', () => {
      cleanup()
      console.log('\n[Application terminated by user]')
      process.exit(0)
    })
    
    process.on('SIGTERM', cleanup)
    process.on('exit', cleanup)
  }

  /**
   * Register AI-specific commands
   */
  async registerAICommands() {
    const { BaseCommand } = await import('../utils/command-manager.js')
    
    // Provider command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('provider', 'Switch AI provider', {
          aliases: ['p'],
          usage: 'provider',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchProvider()
      }
    })
    
    // Model command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('model', 'Switch AI model', {
          aliases: ['m'],
          usage: 'model',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchModel()
      }
    })
    
    // Web command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('web', 'Open link in browser', {
          aliases: ['w'],
          usage: 'web <number>',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        if (args.length === 0) {
          return `${color.yellow}Usage: web <number> or web-<number>${color.reset}\nExample: web 1 or web-5 - opens link from recent extraction`
        }
        
        // Support both "web 5" and "web-5" formats
        let linkNumber
        if (args[0].startsWith('-')) {
          // Handle "web-5" format
          linkNumber = parseInt(args[0].substring(1))
        } else {
          // Handle "web 5" format
          linkNumber = parseInt(args[0])
        }
        
        if (isNaN(linkNumber) || linkNumber < 1) {
          return `${color.red}Error: Please provide a valid link number (1, 2, 3, etc.) or use web-N format${color.reset}`
        }
        
        return await context.app.openLinkInBrowser(linkNumber)
      }
    })
    
    // CMD command
    this.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('cmd', 'Manage custom commands', {
          aliases: ['кмд'],
          usage: 'cmd',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        await context.app.commandEditor.showCommandMenu()
        return '' // Empty return to avoid extra output
      }
    })
  }

  /**
   * Initialize AI components
   */
  async initializeAI() {
    await this.registerAICommands()
    await cache.initialize()
    await this.initializeMCP()
    await multiProviderTranslator.initialize() // Initialize multi-provider translator
    await multiCommandProcessor.initialize() // Initialize universal multi-command processor
    
    // Provider initialization moved to ServiceManager - no more legacy switchProvider!
    // Modern architecture handles provider initialization properly
  }

  /**
   * Initialize MCP components
   */
  async initializeMCP() {
    try {
      logger.debug('Initializing MCP servers')
      
      // Load MCP server configuration
      const mcpConfigPath = new URL('../config/mcp-servers.json', import.meta.url).pathname
      const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8')
      const mcpConfig = JSON.parse(mcpConfigContent)
      
      // Setup built-in servers
      mcpConfig.fetch.server = fetchMCPServer
      mcpConfig['web-search'].server = searchMCPServer
      
      // Initialize MCP manager
      await mcpManager.initialize(mcpConfig)
      
      logger.debug('MCP servers initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize MCP servers:', error)
      // Don't throw - continue without MCP
    }
  }


  /**
   * Switch AI model
   */
  async switchModel() {
    const { execModel } = await import('../utils/index.js')
    
    logger.debug('Starting model selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      // Pass models as strings directly instead of creating unnecessary objects
      const newModel = await execModel(this.aiState.model, this.aiState.models, rl)
      this.aiState.model = newModel
      process.title = this.aiState.model

      logger.debug(`Model changed to: ${this.aiState.model}`)

      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      errorHandler.handleError(error, { context: 'model_switch' })
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
  }

  /**
   * Switch AI provider using modern ServiceManager architecture
   */
  async switchProvider() {
    const { execProvider } = await import('../utils/provider/execProvider.js')
    
    logger.debug('Starting provider selection')
    try {
      const wasRawMode = process.stdin.isRaw
      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(false)
      }

      // Get available providers from modern ServiceManager
      const aiService = this.serviceManager.getAIProviderService()
      if (!aiService) {
        throw new Error('AI provider service not available')
      }
      
      const availableProviders = aiService.getAvailableProviders()
      const currentProvider = aiService.getCurrentProvider()
      
      if (availableProviders.length === 0) {
        console.log(`${color.yellow}No providers available${color.reset}`)
        // RESTORE TERMINAL MODE BEFORE RETURN!
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }
      
      if (availableProviders.length === 1) {
        console.log(`${color.yellow}Only one provider available: ${availableProviders[0].name}${color.reset}`)
        // RESTORE TERMINAL MODE BEFORE RETURN!
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      // Show interactive provider selection menu
      const selectedProvider = await execProvider(currentProvider.key, availableProviders, rl)
      
      if (!selectedProvider) {
        // User cancelled or selected unhealthy provider
        // RESTORE TERMINAL MODE BEFORE RETURN!
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }
      
      if (selectedProvider.key === currentProvider.key) {
        console.log(`${color.yellow}Already using ${selectedProvider.name}${color.reset}`)
        // RESTORE TERMINAL MODE BEFORE RETURN!
        if (process.stdin.isTTY && wasRawMode) {
          process.stdin.setRawMode(true)
        }
        return
      }

      // Switch to selected provider using modern ServiceManager
      await this.serviceManager.switchProvider(selectedProvider.key)
      
      // Update aiState for compatibility with existing code
      const newCurrentProvider = aiService.getCurrentProvider()
      this.aiState.provider = newCurrentProvider.instance
      this.aiState.selectedProviderKey = newCurrentProvider.key
      this.aiState.model = newCurrentProvider.model
      this.aiState.models = selectedProvider.models
      
      // Update process title
      process.title = this.aiState.model

      logger.debug(`Provider switched to: ${newCurrentProvider.key} with model: ${newCurrentProvider.model}`)

      if (process.stdin.isTTY && wasRawMode) {
        process.stdin.setRawMode(true)
      }
    } catch (error) {
      errorHandler.handleError(error, { context: 'provider_switch' })
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
      }
    }
  }

  /**
   * Try to switch to an alternative provider when current one fails
   */
  async tryAlternativeProvider() {
    const availableProviders = Object.keys(API_PROVIDERS)
    const currentProvider = this.aiState.selectedProviderKey
    
    // Try other providers in order: openai, anthropic, deepseek
    const preferredOrder = ['openai', 'anthropic', 'deepseek']
    
    for (const providerKey of preferredOrder) {
      if (providerKey === currentProvider) continue
      
      // Check if provider has API key
      const providerConfig = API_PROVIDERS[providerKey]
      if (!process.env[providerConfig.apiKeyEnv]) {
        continue
      }
      
      try {
        console.log(`${color.cyan}Switching to ${providerConfig.name}...${color.reset}`)
        
        // Find the index of this provider for switchProvider
        const providerKeys = Object.keys(API_PROVIDERS)
        const providerIndex = providerKeys.indexOf(providerKey)
        
        if (providerIndex !== -1) {
          this.aiState.selectedProviderKey = providerKey
          
          // Create and test the provider
          const provider = createProvider(providerKey, providerConfig)
          await provider.initializeClient()
          
          this.aiState.provider = provider
          
          // Fetch models through provider
          const list = await provider.listModels()
          this.aiState.models = list.map(m => m.id).sort((a, b) => a.localeCompare(b))
          
          // Get preferred model for current provider
          const providerDefaults = DEFAULT_MODELS[this.aiState.selectedProviderKey]
          const preferredModels = providerDefaults ? [providerDefaults.model] : []
          this.aiState.model = this.findModel(preferredModels, this.aiState.models)
          process.title = this.aiState.model
          
          console.log(`${color.green}Successfully switched to ${providerConfig.name}${color.reset}`)
          return true
        }
      } catch (error) {
        console.log(`${color.yellow}${providerConfig.name} also unavailable: ${error.message}${color.reset}`)
        continue
      }
    }
    
    console.log(`${color.red}No alternative providers available${color.reset}`)
    return false
  }

  /**
   * Process AI input (override parent method)
   */
  async processAIInput(input) {
    let interval
    let startTime
    const originalInput = input // Save original input for retry
    
    // Setup request state for global handler (moved to beginning)
    this.currentRequestController = new AbortController()
    this.isProcessingRequest = true
    
    // EXPERIMENTAL: Test simple command handler integration
    try {
      const context = { input }
      if (await this.simpleCommandHandler.canHandle(context)) {
        const result = await this.simpleCommandHandler.handle(context)
        
        if (result.handled && result.type === 'system') {
          console.log(result.result)
          this.isProcessingRequest = false
          return
        }
        
        if (result.handled && result.type === 'error') {
          console.log(`${color.red}Error: ${result.error}${color.reset}`)
          this.isProcessingRequest = false
          return
        }
        
        // For instruction commands, continue with existing processing
        if (result.type === 'instruction' && context.instructionCommand) {
          console.log(`${color.cyan}[Handler: ${result.commandKey}]${color.reset}`)
          // Continue with existing logic but use command from handler
        }
      }
    } catch (error) {
      console.warn('SimpleCommandHandler error:', error.message)
      // Continue with legacy processing on handler error
    }
    
    // Check for clipboard content FIRST (before MCP processing)
    if (input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      try {
        const buffer = await getClipboardContent()
        const sanitizedBuffer = sanitizeString(buffer)
        validateString(sanitizedBuffer, 'clipboard content', false)
        
        if (sanitizedBuffer.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Clipboard content too large (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          return
        }
        
        input = input.replace(new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\$/g, '\\$'), 'g'), sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        errorHandler.handleError(error, { context: 'clipboard_read' })
        return
      }
    }
    
    // Check for force flags first (before command processing)
    let forceRequest = false
    for (const flag of APP_CONSTANTS.FORCE_FLAGS) {
      if (input.endsWith(flag)) {
        forceRequest = true
        input = input.replace(new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '').trim()
        break
      }
    }
    
    // Check for command after flag processing
    const command = this.findCommand(input)
    
    // Handle commands with URLs through MCP
    if (command && command.hasUrl) {
      // Any command with URL (translation or not) goes through MCP
      const mcpResult = await this.processMCPInput(command.targetContent, command)
      if (mcpResult && mcpResult.mcpData) {
        console.log(`\n${color.cyan}[MCP]${color.reset}`)
        console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
        console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        
        if (command.isTranslation) {
          // Create translation command with the extracted content
          const webTranslationInstruction = command.instruction.replace('text', 'entire article/webpage content completely')
          input = `${webTranslationInstruction}: ${mcpResult.mcpData.content}`
        } else {
          // For non-translation commands, use enhanced input
          input = mcpResult.enhancedInput
        }
      } else {
        // Fallback to original behavior if MCP fails
        input = command.fullInstruction
      }
    } else if (command && command.isTranslation) {
      // Regular translation commands without URL - go directly to LLM
      input = command.fullInstruction
    } else {
      // Regular commands without URL - check through intentDetector for MCP
      const mcpResult = await this.processMCPInput(input, command)
      if (mcpResult) {
        input = mcpResult.enhancedInput
        if (mcpResult.directResponse) {
          console.log(`\n${color.cyan}[MCP Data]${color.reset}`)
          console.log(mcpResult.directResponse)
          return
        }
        if (mcpResult.showMCPData) {
          console.log(`\n${color.cyan}[MCP]${color.reset}`)
          console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
          console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        }
      }
    }

    // For translation commands with URLs, finalInput is already modified input
    // For other commands, use the original logic
    const finalInput = (command && command.isTranslation && command.hasUrl) ? input : 
                      (command ? command.fullInstruction : input)

    // Check cache for translation commands
    const cacheKey = (command && command.isTranslation && command.hasUrl) ? command.originalInput : finalInput
    
    // Handle multi-provider commands (but exclude multi-model commands - they use new streaming logic)
    if (command && command.isMultiProvider && !forceRequest && 
        !(command.models && Array.isArray(command.models) && command.models.length > 1)) {
      // Check multi-provider cache first
      if (cache.hasMultipleResponses(cacheKey)) {
        console.log(`${color.yellow}[from cache]${color.reset}`)
        const cachedResponses = cache.getMultipleResponses(cacheKey)
        const formattedResponse = multiProviderTranslator.formatMultiProviderResponse({ 
          translations: cachedResponses.map(r => ({ ...r, emoji: undefined })), // Remove emoji from cached responses
          elapsed: 0,
          successful: cachedResponses.filter(r => r.response && !r.error).length,
          total: cachedResponses.length
        })
        process.stdout.write(formattedResponse + '\n')
        return
      }
      
      // Execute multi-provider translation
      try {
        const result = await multiProviderTranslator.translateMultiple(
          command.commandType,
          command.instruction,
          command.targetContent,
          this.currentRequestController.signal,
          command.models
        )
        
        const formattedResponse = multiProviderTranslator.formatMultiProviderResponse(result)
        process.stdout.write(formattedResponse + '\n')
        
        // Cache the responses
        await cache.setMultipleResponses(cacheKey, result.translations)
        
        return
      } catch (error) {
        errorHandler.handleError(error, { context: 'multi_provider_translation' })
        return
      }
    }
    
    // Handle document commands
    if (command && command.isDocCommand && !forceRequest) {
      // Check document cache first
      const docCache = cache.getDocumentFile(cacheKey)
      if (docCache) {
        console.log(`${color.yellow}[from cache]${color.reset}`)
        process.stdout.write(docCache.content + '\n')
        fileManager.showSaveSuccess(docCache.file)
        return
      }
      
      // Execute document translation
      try {
        const result = await multiProviderTranslator.translateSingle(
          command.instruction,
          command.targetContent,
          this.currentRequestController.signal,
          command.models
        )
        
        if (result.result && result.result.response) {
          process.stdout.write(result.result.response + '\n')
          
          // Save to file
          const fileInfo = await fileManager.saveDocumentTranslation(
            result.result.response,
            command.targetContent,
            { command: command.commandKey, timestamp: new Date().toISOString() }
          )
          
          // Show success message
          fileManager.showSaveSuccess(fileInfo)
          
          // Cache document
          await cache.setDocumentFile(cacheKey, fileInfo, result.result.response)
        } else {
          console.log(`${color.red}Document translation failed${color.reset}`)
        }
        
        return
      } catch (error) {
        errorHandler.handleError(error, { context: 'document_translation' })
        return
      }
    }
    
    // Handle any command with multiple models (universal multi-model support)
    if (command && command.models && Array.isArray(command.models) && command.models.length > 1) {
      // Check multi-command cache first (skip if force flag is used)
      if (!forceRequest && cache.hasMultipleResponses(cacheKey)) {
        console.log(`${color.yellow}[from cache]${color.reset}`)
        const cachedResponses = cache.getMultipleResponses(cacheKey)
        const formattedResponse = multiCommandProcessor.formatMultiResponse({ 
          results: cachedResponses.map(r => ({ ...r })),
          elapsed: 0,
          successful: cachedResponses.filter(r => r.response && !r.error).length,
          total: cachedResponses.length,
          isMultiple: cachedResponses.length > 1
        })
        process.stdout.write(formattedResponse + '\n')
        return
      }
      
      // Execute universal multi-command processing with sequential display
      try {
        let displayedCount = 0
        const totalModels = command.models.length
        

        // Callback for handling each provider completion
        const onProviderComplete = async (result, index, provider, isFirst) => {
          // ALWAYS stop the main spinner on first callback (regardless of isFirst)
          // This prevents spinner interference with streaming content
          if (this.currentSpinnerInterval) {
            clearInterval(this.currentSpinnerInterval)
            this.currentSpinnerInterval = null
            clearTerminalLine()
            process.stdout.write('\x1B[?25h') // Show cursor
          }
          
          if (isFirst) {
            // First model - show header and prepare for streaming
            const finalTime = getElapsedTime(startTime)
            showStatus('success', finalTime)
            this.isProcessingRequest = false
            this.isTypingResponse = true
            
            // Display provider header for first streaming model
            const providerLabel = provider.model 
              ? `${provider.name} (${provider.model})`
              : provider.name
            process.stdout.write(`\n${color.cyan}${providerLabel}${color.reset}:\n`)
            
            // The streaming content will be written directly by MultiCommandProcessor
            return
          }
          
          // Handle non-first models: display headers when their turn comes
          // This is called by leaderboard system when model should start displaying
          if (result) {
            displayedCount++
            
            // Display provider header for this model
            const providerLabel = result.model 
              ? `${result.provider} (${result.model})`
              : result.provider
            process.stdout.write(`\n${color.cyan}${providerLabel}${color.reset}:\n`)
            
            // For non-first models, content streams in real-time via onChunk
            // No need to output content here, just ensure proper spacing
            if (result.error) {
              // Show error for models that failed
              process.stdout.write(`${color.red}Error: ${result.error}${color.reset}\n`)
            }
            
            logger.debug(`Displayed header for model ${displayedCount}: ${result.provider}`)
          }
        }
        
        // Initialize timing before spinner
        startTime = Date.now()
        
        // Start initial spinner (will be stopped when first model starts streaming)
        let spinnerIndex = 0
        process.stdout.write('\x1B[?25l') // Hide cursor
        this.currentSpinnerInterval = setInterval(() => {
          clearTerminalLine()
          const elapsedTime = getElapsedTime(startTime)
          // Show waiting message without model count during initial loading
          process.stdout.write(
            `${color.reset}${UI_SYMBOLS.SPINNER[spinnerIndex++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s Loading models...${color.reset}`,
          )
        }, configManager.get('spinnerInterval'))
        
        const result = await multiCommandProcessor.executeMultiple(
          finalInput,
          this.currentRequestController.signal,
          command.models,
          null,
          onProviderComplete
        )
        
        // Clear spinner if still active
        if (this.currentSpinnerInterval) {
          clearInterval(this.currentSpinnerInterval)
          this.currentSpinnerInterval = null
        }
        clearTerminalLine()
        process.stdout.write('\x1B[?25h') // Show cursor
        this.isProcessingRequest = false
        this.isTypingResponse = false
        
        // Add summary if multiple providers
        if (result.results.length > 1) {
          process.stdout.write(`\n${color.grey}[${result.successful}/${result.total} models responded in ${result.elapsed}s]${color.reset}\n`)
        }
        
        // Cache the responses (using same structure as multi-provider translator for compatibility)
        cache.setMultipleResponses(cacheKey, result.results.map(r => ({
          provider: r.provider,
          model: r.model,
          response: r.response,
          error: r.error
        })))
        
        return
      } catch (error) {
        // Clear spinner on error
        if (this.currentSpinnerInterval) {
          clearInterval(this.currentSpinnerInterval)
          this.currentSpinnerInterval = null
        }
        clearTerminalLine()
        process.stdout.write('\x1B[?25h') // Show cursor
        this.isProcessingRequest = false
        this.isTypingResponse = false
        
        errorHandler.handleError(error, { context: 'multi_command_processing' })
        return
      }
    }
    
    // Standard single-provider translation cache check
    if (command && command.isTranslation && !forceRequest && cache.has(cacheKey)) {
      console.log(`${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cache.get(cacheKey) + '\n')
      return
    }

    try {
      let messages = []
      if (command && command.isTranslation) {
        messages = [{ role: 'user', content: finalInput }]
      } else {
        messages = this.state.contextHistory.map(({ role, content }) => ({ role, content }))
        messages.push({ role: 'user', content: finalInput })
      }

      startTime = Date.now()

      // Start spinner before making API call
      let i = 0
      process.stdout.write('\x1B[?25l') // Hide cursor
      this.currentSpinnerInterval = setInterval(() => {
        clearTerminalLine()
        const elapsedTime = getElapsedTime(startTime)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
        )
      }, configManager.get('spinnerInterval'))
      interval = this.currentSpinnerInterval

      // Use provider for API calls
      const stream = await this.aiState.provider.createChatCompletion(this.aiState.model, messages, {
        stream: true,
        signal: this.currentRequestController.signal
      })

      const streamProcessor = new StreamProcessor(this.aiState.selectedProviderKey)
      this.currentStreamProcessor = streamProcessor
      let response = []
      let firstChunk = true
      
      // Setup streaming output callback  
      const onChunk = async (content) => {
        // Check if user explicitly cancelled
        if (this.currentRequestController?.signal?.aborted || this.shouldReturnToPrompt) {
          return // Stop processing chunks if user cancelled
        }
        
        if (firstChunk) {
          // Stop spinner and show success on first chunk
          clearInterval(this.currentSpinnerInterval)
          this.currentSpinnerInterval = null
          
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime)
          
          // Switch to typing mode immediately
          this.isProcessingRequest = false
          this.isTypingResponse = true
          firstChunk = false
        }
        
        // Simple chunk output - just write content as it comes
        if (this.isTypingResponse) {
          process.stdout.write(content)
        }
      }
      
      try {
        // Use Promise.race for IMMEDIATE cancellation
        response = await Promise.race([
          streamProcessor.processStream(stream, this.currentRequestController.signal, onChunk),
          // Immediate abort promise that resolves instantly on cancellation
          new Promise((resolve, reject) => {
            // Set up immediate abort listener
            const abortHandler = () => {
              // Force immediate rejection - no waiting
              setTimeout(() => reject(new Error('AbortError')), 0)
            }
            
            // Safety check before adding listener
            if (this.currentRequestController && this.currentRequestController.signal) {
              this.currentRequestController.signal.addEventListener('abort', abortHandler, { once: true })
            }
            
            // Also check termination flag very rapidly
            const rapidCheck = () => {
              // Safety check for null controller
              if (!this.currentRequestController || !this.currentRequestController.signal) {
                return // Stop checking if controller is gone
              }
              
              if (this.currentStreamProcessor?.isTerminated || this.shouldReturnToPrompt) {
                setTimeout(() => reject(new Error('AbortError')), 0)
              } else if (!this.currentRequestController.signal.aborted) {
                setTimeout(rapidCheck, 5) // Check every 5ms
              }
            }
            rapidCheck()
          }),
          // Nuclear option: force timeout after 200ms of abort signal
          new Promise((_, reject) => {
            const forceTimeout = () => {
              // Safety check for null controller
              if (!this.currentRequestController || !this.currentRequestController.signal) {
                return // Stop checking if controller is gone
              }
              
              if (this.currentRequestController.signal.aborted) {
                setTimeout(() => reject(new Error('AbortError')), 200)
              } else {
                setTimeout(forceTimeout, 100)
              }
            }
            forceTimeout()
          })
        ])
      } catch (error) {
        if (error.message === 'AbortError' || error.name === 'AbortError' || error.message === 'Stream processing aborted' || error.message.includes('aborted') || error.message.includes('Aborted with Ctrl+C')) {
          // For AbortError, just continue with empty response
          response = []
        } else {
          throw error
        }
      }

      clearInterval(interval)

      if (this.currentRequestController.signal.aborted || this.shouldReturnToPrompt) {
        // Only show cancellation if no content was output yet
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('error', finalTime)
        } else {
          // Content was already streaming, no extra newline needed
        }
        
        // Reset flags when cancelled during streaming
        this.shouldReturnToPrompt = false
        this.isTypingResponse = false
        return
      } else {
        // Stream completed successfully
        this.isTypingResponse = false
        
        // If no content was output (empty response), show completion
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime, 'No content received.')
        } else {
          // Content was streaming, add newline for translations
          if (command && command.isTranslation) {
            process.stdout.write('\n')
          }
        }
        
        // Check if we should return to prompt immediately
        if (this.shouldReturnToPrompt) {
          this.shouldReturnToPrompt = false
          return // Early return to avoid context processing
        }

        // Handle caching and context
        const fullResponse = response.join('')
        if (command && command.isTranslation) {
          await cache.set(cacheKey, fullResponse)
        } else {
          this.addToContext('user', finalInput)
          this.addToContext('assistant', fullResponse)
          
          const maxHistory = configManager.get('maxContextHistory')
          if (this.state.contextHistory.length > maxHistory) {
            this.state.contextHistory = this.state.contextHistory.slice(-maxHistory)
          }
          
          const historyDots = '.'.repeat(this.state.contextHistory.length)
          process.stdout.write('\n' + color.yellow + historyDots + color.reset + '\n')
        }
      }
    } catch (error) {
      if (interval) clearInterval(interval)
      process.stdout.write('')
      const finalTime = getElapsedTime(startTime)

      if (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('Aborted with Ctrl+C')) {
        clearTerminalLine()
        showStatus('error', finalTime)
      } else {
        // Check if it's a 403 error and try to switch to another provider (only once)
        if (error.message && error.message.includes('403') && error.message.includes('Country, region, or territory not supported') && !this.isRetryingProvider) {
          // Clear spinner immediately without showing time
          clearTerminalLine()
          console.log(`${color.yellow}Region blocked for ${this.aiState.selectedProviderKey}. Trying alternative provider...${color.reset}`)
          
          this.isRetryingProvider = true
          
          // Try to switch to another available provider
          if (await this.tryAlternativeProvider()) {
            // Retry the request with the new provider
            const result = await this.processAIInput(originalInput, command)
            this.isRetryingProvider = false
            return result
          } else {
            // All providers failed - graceful shutdown
            console.log(`${color.red}All API providers are unavailable.${color.reset}`)
            console.log(`${color.yellow}Please check your internet connection and API keys.${color.reset}`)
            process.exit(1)
          }
        }
        
        // For all other errors, show status first then error message
        clearTerminalLine()
        showStatus('error', finalTime)
        errorHandler.handleError(error, { context: 'ai_processing' })
      }
    } finally {
      // Critical: Always clean up properly
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      if (this.currentSpinnerInterval) {
        clearInterval(this.currentSpinnerInterval)
        this.currentSpinnerInterval = null
      }
      
      // Clear request state
      this.isProcessingRequest = false
      this.currentRequestController = null
      this.currentStreamProcessor = null
      
      // Show cursor
      process.stdout.write('\x1B[?25h') // Show cursor
    }
  }

  /**
   * Modern handler-based AI input processing using Chain of Responsibility
   * This method replaces the massive processAIInput with a clean, modular approach
   * @param {string} input - User input to process
   * @returns {Promise<void>}
   */
  async processAIInputViaHandlers(input) {
    try {
      // Fallback to legacy method if handlers not available
      if (!this.requestHandlers || this.requestHandlers.length === 0) {
        logger.warn('Handler chain not available, falling back to legacy processing')
        return await this.processAIInput(input)
      }

      // Setup request state for global handler (consistent with legacy method)
      this.currentRequestController = new AbortController()
      this.isProcessingRequest = true

      // Create processing context
      const context = {
        // Input data
        originalInput: input,
        processedInput: input,
        
        // Request control
        abortController: this.currentRequestController,
        
        // Flags and command info (will be populated by handlers)
        flags: {},
        command: null,
        instructionInfo: null,
        cacheInfo: null,
        mcpData: null,
        
        // Processing metadata
        metadata: {
          startTime: Date.now(),
          processingSteps: [],
          handlerChain: []
        },
        
        // Services and dependencies
        services: {
          app: this,
          contextHistory: this.state.contextHistory,
          addToContext: this.addToContext.bind(this),
          userSession: {},
          
          // AI state for compatibility
          provider: this.aiState.provider,
          model: this.aiState.model,
          selectedProviderKey: this.aiState.selectedProviderKey
        },
        
        // Shared data between handlers
        processingData: new Map()
      }

      logger.debug(`Starting handler chain processing for input: ${input.substring(0, 50)}...`)

      // Start the handler chain with the first handler
      const firstHandler = this.requestHandlers[0]
      const result = await firstHandler.handle(context)

      // Log final result - adapt BaseRequestHandler result format
      const success = result.handled !== false && !result.metadata?.error
      const error = result.metadata?.error || null
      
      if (success) {
        const elapsed = Date.now() - context.metadata.startTime
        logger.debug(`Handler chain completed successfully in ${elapsed}ms`)
        
        // Emit completion event
        this.eventBus?.emit('processing:completed', {
          success: true,
          elapsed,
          handlerChain: context.metadata.handlerChain,
          inputLength: input.length,
          resultType: typeof result.result
        })
      } else {
        logger.warn(`Handler chain failed: ${error || 'Unknown error'}`)
        
        // Emit failure event
        this.eventBus?.emit('processing:failed', {
          success: false,
          error: error,
          handlerChain: context.metadata.handlerChain
        })
      }

    } catch (error) {
      logger.error(`Handler chain processing failed: ${error.message}`)
      
      // Emit critical error event
      this.eventBus?.emit('processing:critical-error', {
        error: error.message,
        stack: error.stack
      })

      // Fallback to legacy processing on critical errors
      logger.warn('Falling back to legacy processing due to critical error')
      return await this.processAIInput(input)
      
    } finally {
      // Critical: Always clean up properly (consistent with legacy method)
      this.isProcessingRequest = false
      this.currentRequestController = null
      this.currentStreamProcessor = null
      
      // Show cursor
      process.stdout.write('\x1B[?25h')
    }
  }

  /**
   * Check if command is a system command from SYS_INSTRUCTIONS
   */
  isSystemCommand(commandName) {
    for (const prop in SYS_INSTRUCTIONS) {
      if (SYS_INSTRUCTIONS[prop].key && SYS_INSTRUCTIONS[prop].key.includes(commandName)) {
        return true
      }
    }
    return false
  }

  /**
   * Find command in instructions
   */
  findCommand(str) {
    const TRANSLATION_KEYS = [
      'RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
    ]
    
    
    // Document translation commands
    const DOC_COMMANDS = ['doc']
    
    const arr = str.trim().split(' ')
    const commandKey = arr.shift()
    
    const INSTRUCTIONS = getInstructionsFromDatabase()
    for (const prop in INSTRUCTIONS) {
      if (INSTRUCTIONS[prop].key.includes(commandKey)) {
        const restString = arr.join(' ')
        const isTranslation = TRANSLATION_KEYS.includes(prop)
        const isDocCommand = prop === 'DOC' || DOC_COMMANDS.includes(commandKey)
        
        // Dynamic multi-model detection - only based on actual models array
        const hasMultipleModels = INSTRUCTIONS[prop].models && 
                                  Array.isArray(INSTRUCTIONS[prop].models) && 
                                  INSTRUCTIONS[prop].models.length > 1
        const isMultiProvider = hasMultipleModels
        
        // Check if this is a translation command with URL - handle specially
        const hasUrl = restString && (restString.startsWith('http') || restString.includes('://'))
        
        return {
          fullInstruction: `${INSTRUCTIONS[prop].instruction}: ${restString}`,
          isTranslation,
          isDocCommand,
          isMultiProvider,
          hasUrl,
          originalInput: str,
          commandKey,
          commandType: prop,
          targetContent: restString,
          instruction: INSTRUCTIONS[prop].instruction,
          models: INSTRUCTIONS[prop].models || null
        }
      }
    }
    return null
  }

  /**
   * Find suitable model from defaults
   */
  findModel(defaultModels, models) {
    for (const defaultModel of defaultModels) {
      const currentModel = models.find((modelId) => modelId.includes(defaultModel))
      if (currentModel) {
        return currentModel
      }
    }
    return models[0]
  }

  /**
   * Process MCP input and enhance with external data
   */
  async processMCPInput(input, command = null) {
    try {
      // Detect if input requires MCP processing
      if (!intentDetector.requiresMCP(input)) {
        return null
      }
      
      const intents = intentDetector.detectIntent(input)
      if (intents.length === 0) {
        return null
      }
      
      const routing = intentDetector.getMCPRouting(intents)
      if (!routing) {
        return null
      }
      
      logger.debug(`MCP routing: ${routing.server}/${routing.tool}`)
      
      // Call MCP server
      const mcpData = await this.callMCPServer(routing.server, routing.tool, routing.args)
      
      if (!mcpData) {
        return null
      }
      
      // Format the MCP data for AI consumption
      const formattedData = this.formatMCPData(mcpData, intents[0], command)
      
      // Detect language from original input AND content for response
      const isRussianInput = /[а-яё]/i.test(input)
      const isForeignContent = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u0600-\u06ff]/i.test(formattedData.content || '')
      
      // Determine response language based on input language (user preference)
      const language = isRussianInput ? 'русском' : 'English'
      
      // Create language instruction based on detected language
      const languageInstruction = isRussianInput 
        ? 'ОБЯЗАТЕЛЬНО отвечай на русском языке!'
        : 'MUST respond in English!'
      
      // Add content language information to instruction
      const contentLanguageInfo = isForeignContent
        ? (isRussianInput
          ? '\n\nВАЖНО: Контент на иностранном языке - переведи основную информацию на русский язык.'
          : '\n\nIMPORTANT: Content is in a foreign language - translate the main information to English.')
        : ''
      
      // Add link instructions if links are present (but not for translation commands)
      let linkInstructions = ''
      if (formattedData.links && formattedData.links.length > 0 && !(command && command.isTranslation)) {
        linkInstructions = isRussianInput 
          ? '\n\nОБЯЗАТЕЛЬНО отвечай на русском языке!\n\nВАЖНО: Умный вывод контента:\n' +
            '• Если это ГЛАВНАЯ СТРАНИЦА новостного сайта (Meduza, RBC, Lenta, Коммерсант, Forbes, Ведомости, Газета.ру, RT, ТАСС, Интерфакс, Фонтанка, и т.д.) и контент состоит только из списка заголовков без статей, покажи заголовки как список ссылок в формате "• Название новости [web-N]".\n' +
            '• Если это ОТДЕЛЬНАЯ СТАТЬЯ (даже на новостном сайте), покажи полное содержимое статьи, а затем релевантные ссылки отдельно.\n' +
            '• Для ВСЕХ остальных сайтов показывай содержимое + ссылки отдельно. Исключай навигационные ссылки (главная, контакты, обратная связь, установить как главную, названия сайтов и т.д.)\n' +
            '• ОБЯЗАТЕЛЬНО добавь в конце понятные инструкции для пользователя на русском языке\n\n' +
            'Пользователь может:\n' +
            '- Написать "web-N" для получения содержимого ссылки (например, "web-5")\n' +
            '- Описать нужную ссылку ("открой новость про туризм")\n' +
            '- Использовать команду "web-N" чтобы открыть ссылку в браузере'
          : '\n\nMUST respond in English language!\n\nIMPORTANT: Smart content output:\n' +
            '• If this is a MAIN PAGE of a news website (Meduza, RBC, BBC, CNN, Reuters, TechCrunch, Hacker News, etc.) and content consists only of headlines list without articles, show headlines as links list in format "• Headline title [web-N]".\n' +
            '• If this is an INDIVIDUAL ARTICLE (even on news sites), show full article content, then relevant links separately.\n' +
            '• For ALL other websites show content + links separately. Exclude navigation links (home, contacts, feedback, set as homepage, site names, etc.)\n' +
            '• ALWAYS add clear instructions for the user in English at the end\n\n' +
            'Users can:\n' +
            '- Type "web-N" to get link content (e.g., "web-5")\n' +
            '- Describe the desired link ("open news about tourism")\n' +
            '- Use "web-N" command to open the link in browser'
      }
      
      // For some intents, we might want to show data directly
      if ((intents[0].type === 'webpage' || intents[0].type === 'follow_link') && formattedData.content) {
        // For webpage extractions, show enhanced content and pass to AI
        const enhancedInput = `${input}\n\nContent from webpage:\n${formattedData.text}\n\n${languageInstruction}${contentLanguageInfo}${linkInstructions}`
        return {
          enhancedInput,
          showMCPData: true,
          mcpData: formattedData
        }
      }
      
      // Enhance input with MCP data
      const enhancedInput = `${input}\n\n[Additional context from web search/fetch:]\n${formattedData.text}\n\n${languageInstruction}${contentLanguageInfo}${linkInstructions}`
      
      return {
        enhancedInput,
        mcpData: formattedData
      }
      
    } catch (error) {
      logger.error('MCP processing failed:', error)
      return null
    }
  }

  /**
   * Call MCP server with error handling
   */
  async callMCPServer(serverName, toolName, args) {
    try {
      logger.debug(`Calling MCP: ${serverName}/${toolName}`)
      
      // For built-in servers, call directly
      if (serverName === 'fetch') {
        return await fetchMCPServer.callTool(toolName, args)
      } else if (serverName === 'web-search') {
        return await searchMCPServer.callTool(toolName, args)
      }
      
      // For external servers, use MCP manager
      return await mcpManager.callTool(serverName, toolName, args)
      
    } catch (error) {
      logger.error(`MCP call failed: ${error.message}`)
      throw error
    }
  }

  /**
   * Format MCP data for AI consumption
   */
  formatMCPData(mcpData, intent, command = null) {
    switch (intent.type) {
      case 'webpage':
      case 'follow_link':
        // Format links for LLM (but not for translation commands)
        let linksText = ''
        if (mcpData.links && mcpData.links.length > 0 && !(command && command.isTranslation)) {
          linksText = '\n\nRelated links found in this article:\n' + 
            mcpData.links.map((link, index) => `${index + 1}. ${link.text} [web]`).join('\n')
        }
        
        // Check if this was a followed link
        let followedFromText = ''
        if (mcpData.followedFrom) {
          followedFromText = `\n\n[Followed from: ${mcpData.followedFrom.linkText}]`
        }
        
        return {
          type: 'webpage',
          url: mcpData.url,
          title: mcpData.title,
          content: mcpData.content,
          links: mcpData.links || [],
          followedFrom: mcpData.followedFrom,
          summary: `${mcpData.title}\n\n${mcpData.content.substring(0, 500)}${mcpData.content.length > 500 ? '...' : ''}`,
          text: `Website: ${mcpData.url}\nTitle: ${mcpData.title}${followedFromText}\nContent: ${mcpData.content}${linksText}`
        }
      
      
      case 'search':
        const searchResults = mcpData.results || []
        const searchSummary = searchResults.map(result => 
          `• ${result.title}\n  ${result.content}\n  ${result.url}`
        ).join('\n\n')
        
        return {
          type: 'search',
          query: mcpData.query,
          results: searchResults,
          summary: `Search Results: ${mcpData.query}\n\n${searchSummary}`,
          text: `Search results for "${mcpData.query}":\n\n${searchSummary}`
        }
      
      default:
        return {
          type: 'unknown',
          text: JSON.stringify(mcpData, null, 2)
        }
    }
  }




  /**
   * Open link in browser by number
   */
  async openLinkInBrowser(linkNumber) {
    try {
      // Check if we have recent extractions
      if (!fetchMCPServer.recentExtractions || fetchMCPServer.recentExtractions.size === 0) {
        return `${color.red}Error: No recent extractions found. Please extract content from a webpage first.${color.reset}`
      }
      
      // Get the most recent extraction
      const entries = Array.from(fetchMCPServer.recentExtractions.entries())
      const mostRecentExtraction = entries[entries.length - 1][1]
      
      // Check if extraction has links
      if (!mostRecentExtraction.links || mostRecentExtraction.links.length === 0) {
        return `${color.red}Error: No links found in recent extraction.${color.reset}`
      }
      
      // Validate link number
      if (linkNumber > mostRecentExtraction.links.length) {
        return `${color.red}Error: Link ${linkNumber} does not exist. Available links: 1-${mostRecentExtraction.links.length}${color.reset}`
      }
      
      // Get the link
      const link = mostRecentExtraction.links[linkNumber - 1]
      
      // Open in browser
      await openInBrowser(link.url)
      
      return `${color.green}✓${color.reset} Opened link ${linkNumber} in browser: ${color.cyan}${link.text}${color.reset}\n${color.grey}URL: ${link.url}${color.reset}`
      
    } catch (error) {
      logger.error(`Failed to open link in browser: ${error.message}`)
      return `${color.red}Error: Failed to open link in browser. ${error.message}${color.reset}`
    }
  }

  /**
   * Main application loop
   */
  async run() {
    // Migrate existing instructions to database on first run
    await migrateInstructionsToDatabase()
    
    // Initialize service manager
    try {
      await this.serviceManager.initialize()
      console.log(`${color.green}✓ Modern services initialized${color.reset}`)
    } catch (error) {
      console.warn(`${color.yellow}Warning: Service manager initialization failed: ${error.message}${color.reset}`)
      console.log(`${color.grey}Continuing with legacy architecture...${color.reset}`)
    }
    
    process.title = this.aiState.model
    // Don't log here as it interferes with the prompt
    
    while (true) {
      const colorInput = this.aiState.model.includes('chat') ? color.green : color.yellow
      let userInput = await rl.question(`\n${colorInput}> `)
      userInput = userInput.trim()

      if (!userInput) {
        if (this.state.contextHistory.length) {
          this.clearContext()
          console.log(color.yellow + 'Context history cleared')
        } else {
          setTimeout(() => process.stdout.write('\x1b[2J\x1b[0;0H> '), APP_CONSTANTS.CLEAR_TIMEOUT)
        }
        continue
      }

      try {
        // Validate and sanitize input
        userInput = sanitizeString(userInput)
        
        if (userInput.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Input too long (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          continue
        }
        
        validateString(userInput, 'user input', true)
        
        // Check if it's a command first
        const words = userInput.trim().split(' ')
        const commandName = words[0]
        const args = words.slice(1)
        
        // Check system commands first (includes cmd)
        if (this.isSystemCommand(commandName)) {
          if (commandName === 'cmd' || commandName === 'кмд') {
            await this.commandEditor.showCommandMenu()
            continue
          }
        }
        
        if (this.commands.hasCommand(commandName) || this.aiCommands.hasCommand(commandName)) {
          const startTime = Date.now()
          try {
            let result
            
            // Try AI commands first, then core commands
            if (this.aiCommands.hasCommand(commandName)) {
              result = await this.aiCommands.executeCommand(commandName, args, {
                app: this,
                user: this.state.userSession
              })
              if (result) console.log(result)
            } else {
              result = await this.commands.executeCommand(commandName, args, {
                app: this,
                user: this.state.userSession
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
        } else {
          // Process as AI input
          await this.processAIInput(userInput)
        }
        
      } catch (error) {
        // Skip error handling for user cancellation (Ctrl+C, ESC, etc.)
        if (error.message && (error.message.includes('Aborted with Ctrl+C') || 
            error.message === 'AbortError' || error.name === 'AbortError' ||
            error.message.includes('aborted') || error.message.includes('cancelled'))) {
          continue
        }
        errorHandler.handleError(error, { context: 'user_input' })
        continue
      }
    }
  }
}

/**
 * Start the application
 */
async function start() {
  const aiApp = new AIApplication()
  
  try {
    logger.debug('Starting AI application')
    await aiApp.initialize()
    await aiApp.initializeAI()
    // Don't log here as it interferes with first prompt
    await aiApp.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()