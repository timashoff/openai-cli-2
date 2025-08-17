#!/usr/bin/env node

/**
 * AI CLI Application - Phase 2 Complete Architecture 
 * Integrates existing business logic with new core/ and commands/ architecture
 */

import { Application } from '../utils/application.js'
import { CommandManager } from '../utils/command-manager.js'
import { color } from '../config/color.js'
import { UI_SYMBOLS, APP_CONSTANTS } from '../config/constants.js'
import { getClipboardContent, openInBrowser, getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { CommandEditor } from '../utils/command-editor.js'
import cache from '../utils/cache.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'
// Migration no longer needed - commands already in database  
// import { migrateInstructionsToDatabase } from '../utils/migration.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { ServiceManager, getServiceManager } from '../services/service-manager.js'
import { CommandRouter } from '../commands/CommandRouter.js'
import { CLIManager } from '../core/CLIManager.js'
import { AIProcessor } from '../core/AIProcessor.js'
import { ApplicationInitializer } from '../core/ApplicationInitializer.js'
import { ProviderSwitcher } from '../core/ProviderSwitcher.js'
import { commandObserver } from '../patterns/CommandObserver.js'
import { stateObserver } from '../patterns/StateObserver.js'
import { getStateManager } from '../core/StateManager.js'

/**
 * Phase 2 AI Application with integrated business logic
 */
class AIApplication extends Application {
  constructor() {
    super()
    
    // Get StateManager instance (replaces direct aiState)
    this.stateManager = getStateManager()
    
    // Command managers
    this.aiCommands = new CommandManager()
    
    // Modern command system - uses extracted components:
    // - CommandRouter for command routing 
    // - ProviderSwitcher for provider switching
    // - AIProcessor for AI processing
    // - CLIManager for CLI management
    
    // CLI Manager (extracted) - must be created before CommandEditor
    this.cliManager = new CLIManager(this)
    
    // Legacy systems
    this.commandEditor = new CommandEditor(this, this.cliManager.rl)
    this.serviceManager = getServiceManager(this)
    
    // AI Processor (extracted)
    this.aiProcessor = new AIProcessor(this)
    
    // Command Router (extracted)
    this.commandRouter = new CommandRouter(this)
    
    // Application Initializer (extracted)
    this.applicationInitializer = new ApplicationInitializer(this)
    
    // Provider Switcher (extracted)
    this.providerSwitcher = new ProviderSwitcher(this)
  }

  /**
   * Get AI state (for backward compatibility)
   */
  get aiState() {
    return this.stateManager.getAIState()
  }

  /**
   * Process command (delegated to CommandRouter)
   */
  async processCommand(commandName, args, fullInput) {
    await this.commandRouter.processCommand(commandName, args, fullInput)
  }



  /**
   * Initialize AI components (with original business logic)
   */
  async initializeAI() {
    await cache.initialize()
    await this.applicationInitializer.initializeAI()
  }


  /**
   * Switch AI model (delegated to ProviderSwitcher)
   */
  async switchModel() {
    await this.providerSwitcher.switchModel()
  }

  /**
   * Switch AI provider (delegated to ProviderSwitcher)
   */
  async switchProvider() {
    await this.providerSwitcher.switchProvider()
  }

  /**
   * Process AI input (delegated to AIProcessor)
   */
  async processAIInput(input) {
    return await this.aiProcessor.processAIInput(input, this.cliManager)
  }

  /**
   * Find command in instructions (delegated to AIProcessor)
   */
  async findCommand(str) {
    return await this.aiProcessor.findCommand(str)
  }

  /**
   * Process MCP input (delegated to AIProcessor)
   */
  async processMCPInput(input, command = null) {
    return await this.aiProcessor.processMCPInput(input, command)
  }

  /**
   * Call MCP server (delegated to AIProcessor)
   */
  async callMCPServer(serverName, toolName, args) {
    return await this.aiProcessor.callMCPServer(serverName, toolName, args)
  }

  /**
   * Format MCP data (delegated to AIProcessor)
   */
  formatMCPData(mcpData, intent, command = null) {
    return this.aiProcessor.formatMCPData(mcpData, intent, command)
  }

  /**
   * Open link in browser (delegated to AIProcessor)
   */
  async openLinkInBrowser(linkNumber) {
    return await this.aiProcessor.openLinkInBrowser(linkNumber)
  }


  /**
   * Main application run loop (delegated to CLIManager)
   */
  async run() {
    // Migration no longer needed - commands already in database
    // await migrateInstructionsToDatabase()
    
    // Start observers for comprehensive session tracking
    stateObserver.startObserving({
      trackMetrics: true,
      trackHistory: true,
      debug: logger.level === 'debug'
    })
    
    commandObserver.startObserving({
      trackMetrics: true,
      trackCache: true,
      debug: logger.level === 'debug'
    })
    
    // Initialize providers with CLIManager spinner
    try {
      await this.cliManager.showInitializationSpinner(async () => {
        await this.serviceManager.initialize()
      })
      
      // Show current model info after spinner cleanup
      const aiService = this.serviceManager.getAIProviderService()
      if (aiService) {
        const currentProvider = aiService.getCurrentProvider()
        if (currentProvider && currentProvider.key) {
          const providerName = API_PROVIDERS[currentProvider.key]?.name || currentProvider.key
          const modelName = currentProvider.model || 'unknown'
          console.log(`current model is ${providerName} ${modelName}`)
        }
      }
      
      
    } catch (error) {
      console.error(`${color.red}Error: Service manager initialization failed: ${error.message}${color.reset}`)
      throw error
    }
    
    process.title = this.stateManager.getAIState().model
    
    // Delegate main loop to CLIManager
    await this.cliManager.startMainLoop()
  }
}

/**
 * Start the Phase 2 application
 */
async function start() {
  const aiApp = new AIApplication()
  
  try {
    logger.debug('🚀 Starting Phase 2 AI Application')
    await aiApp.initialize()
    // initializeAI will be called inside run() during spinner - removing double call
    await aiApp.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()