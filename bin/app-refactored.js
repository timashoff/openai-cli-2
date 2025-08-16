#!/usr/bin/env node

/**
 * AI CLI Application - Refactored Architecture (Phase 2 Complete)
 * Uses modern component-based architecture with core/ and commands/ modules
 */

// Core Architecture
import { Application } from '../core/Application.js'
import { getStateManager } from '../core/StateManager.js' 
import { getCLIInterface } from '../core/CLIInterface.js'
import { createRequestRouter } from '../core/RequestRouter.js'

// Command System
import { CommandExecutor } from '../commands/CommandExecutor.js'
import { ProviderCommand } from '../commands/ProviderCommand.js'
import { ModelCommand } from '../commands/ModelCommand.js'
import { HelpCommand } from '../commands/HelpCommand.js'

// Legacy Dependencies (to be refactored in Phase 3)
import { CommandManager } from '../utils/command-manager.js'
import { ServiceManager, getServiceManager } from '../services/service-manager.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { intentDetector } from '../utils/intent-detector.js'
import cache from '../utils/cache.js'
import { multiProviderTranslator } from '../utils/multi-provider-translator.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { CommandEditor } from '../utils/command-editor.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { migrateInstructionsToDatabase } from '../utils/migration.js'

/**
 * Modern AIApplication using Phase 2 Architecture
 */
class RefactoredAIApplication extends Application {
  constructor() {
    // Initialize state manager first
    const stateManager = getStateManager()
    const cliInterface = getCLIInterface(stateManager)
    
    // Initialize with modern dependencies
    const dependencies = {
      serviceManager: null, // Will be initialized
      mcpManager,
      intentDetector,
      cache,
      multiProviderTranslator, 
      multiCommandProcessor,
      commandHandler: null // Will be initialized
    }
    
    super(dependencies)
    
    // Modern command system
    this.commandExecutor = null
    this.systemCommands = new CommandManager()
    this.aiCommands = new CommandManager()
    this.commandEditor = null
    
    // Legacy compatibility
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
  }
  
  /**
   * Initialize the refactored application
   */
  async initialize() {
    logger.info('🚀 Starting Phase 2 Architecture')
    
    // Initialize core application
    await super.initialize()
    
    // Initialize service manager for AI functionality
    this.serviceManager = getServiceManager(this)
    this.dependencies.serviceManager = this.serviceManager
    
    // Initialize command editor
    this.commandEditor = new CommandEditor(this)
    
    // Create request router with all dependencies
    this.requestRouter = createRequestRouter({
      stateManager: this.stateManager,
      cliInterface: this.cliInterface,
      serviceManager: this.serviceManager,
      mcpManager: this.mcpManager,
      intentDetector: this.intentDetector,
      cache: this.cache,
      multiProviderTranslator: this.multiProviderTranslator,
      multiCommandProcessor: this.multiCommandProcessor
    })
    
    // Initialize command executor with all dependencies
    this.commandExecutor = new CommandExecutor({
      stateManager: this.stateManager,
      cliInterface: this.cliInterface,
      serviceManager: this.serviceManager,
      requestRouter: this.requestRouter,
      systemCommands: this.systemCommands,
      aiCommands: this.aiCommands,
      commandEditor: this.commandEditor
    })
    
    // Initialize legacy dependencies
    await this.initializeLegacySystems()
    
    // Register commands
    await this.registerCommands()
    
    logger.info('✅ Phase 2 Architecture initialized successfully')
  }
  
  /**
   * Initialize legacy systems that haven't been refactored yet
   */
  async initializeLegacySystems() {
    await cache.initialize()
    await this.initializeMCP() 
    await multiProviderTranslator.initialize()
    await multiCommandProcessor.initialize()
    
    // Initialize service manager
    try {
      await this.serviceManager.initialize()
      console.log(`${color.green}✓ Modern services initialized${color.reset}`)
    } catch (error) {
      console.warn(`${color.yellow}Warning: Service manager initialization failed: ${error.message}${color.reset}`)
      console.log(`${color.grey}Continuing with legacy architecture...${color.reset}`)
    }
  }
  
  /**
   * Initialize MCP systems
   */
  async initializeMCP() {
    try {
      logger.debug('Initializing MCP servers')
      const { readFile } = await import('node:fs/promises')
      const { fetchMCPServer } = await import('../utils/fetch-mcp-server.js')
      const { searchMCPServer } = await import('../utils/search-mcp-server.js')
      
      const mcpConfigPath = new URL('../config/mcp-servers.json', import.meta.url).pathname
      const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8')
      const mcpConfig = JSON.parse(mcpConfigContent)
      
      mcpConfig.fetch.server = fetchMCPServer
      mcpConfig['web-search'].server = searchMCPServer
      
      await mcpManager.initialize(mcpConfig)
      logger.debug('MCP servers initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize MCP servers:', error)
    }
  }
  
  /**
   * Register all command handlers
   */
  async registerCommands() {
    // Register AI commands using modern command classes
    const providerCommand = new ProviderCommand(this)
    const modelCommand = new ModelCommand(this)
    const helpCommand = new HelpCommand(this)
    
    this.aiCommands.registerCommand(providerCommand.toBaseCommand())
    this.aiCommands.registerCommand(modelCommand.toBaseCommand())
    this.aiCommands.registerCommand(helpCommand.toBaseCommand())
    
    // Register system commands
    await this.systemCommands.loadCoreCommands()
    
    logger.debug('All commands registered successfully')
  }
  
  /**
   * Main application run loop using modern architecture
   */
  async run() {
    // Migrate database
    await migrateInstructionsToDatabase()
    
    // Set process title
    process.title = this.aiState.model || 'ai-cli'
    
    logger.debug('🎯 Starting main application loop')
    
    // Use CLI Interface for main loop
    await this.cliInterface.startMainLoop(async (userInput) => {
      try {
        // Delegate to command executor
        await this.commandExecutor.executeUserInput(userInput)
      } catch (error) {
        // Handle non-critical errors gracefully
        if (error.message && (
          error.message.includes('Aborted with Ctrl+C') || 
          error.message === 'AbortError' || 
          error.name === 'AbortError' ||
          error.message.includes('aborted') || 
          error.message.includes('cancelled')
        )) {
          return // User cancellation - continue normally
        }
        
        errorHandler.handleError(error, { context: 'user_input' })
      }
    })
  }
}

/**
 * Application entry point
 */
async function start() {
  const app = new RefactoredAIApplication()
  
  try {
    await app.initialize()
    await app.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

// Start the application
start()