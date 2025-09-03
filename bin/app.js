#!/usr/bin/env node
import { Application } from '../utils/application.js'
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'
import { Router } from '../core/Router.js'
import { ApplicationLoop } from '../core/ApplicationLoop.js'
import { createChatRequest } from '../core/ChatRequest.js'
import { createCommandHandler } from '../core/CommandHandler.js'
import { systemCommandHandler } from '../core/system-command-handler.js'
import { CacheManager } from '../core/CacheManager.js'
import { getStateManager } from '../core/StateManager.js'
import { APP_CONFIG } from '../config/app-config.js'
const PROVIDERS = APP_CONFIG.PROVIDERS

class AIApplication extends Application {
  constructor() {
    // Call super with required dependencies for Application
    super({})

    // Get StateManager instance (replaces direct aiState)
    this.stateManager = getStateManager()

    // Application Loop (extracted) - must be created before CommandEditor
    this.applicationLoop = new ApplicationLoop(this)

    // Chat request handler for final processing
    this.chatRequest = createChatRequest(this)

    // System command handler for system commands
    this.systemCommandHandler = systemCommandHandler

    // Cache manager for caching logic
    this.cacheManager = new CacheManager()

    // Command handler for database commands (functional approach)
    this.commandHandler = createCommandHandler(this.chatRequest, this.cacheManager)

    // Router with all handler dependencies
    this.router = new Router({
      systemCommandHandler: this.systemCommandHandler,
      commandHandler: this.commandHandler,
      chatRequest: this.chatRequest
    })
  }

  /**
   * Get AI state (for backward compatibility)
   */
  get aiState() {
    return this.stateManager.getAIState()
  }

  /**
   * Main application run loop
   */
  async run() {

    // Initialize providers with ApplicationLoop spinner - StateManager handles everything
    try {
      await this.applicationLoop.showInitializationSpinner(async () => {
        // Initialize default provider through StateManager
        await this.initializeDefaultProvider()
        // Initialize router if needed
        await this.router.initialize()
      })

      // Show current model info after spinner cleanup
      const currentProvider = this.stateManager.getCurrentProvider()
      const currentModel = this.stateManager.getCurrentModel()
      if (currentProvider && currentModel) {
        console.log(`current model is ${currentProvider.instance.config.name} ${currentModel}`)
      }

    } catch (error) {
      console.error(`${color.red}Error: Provider initialization failed: ${error.message}${color.reset}`)
      throw error
    }

    process.title = this.stateManager.getCurrentModel()

    // Delegate main loop to ApplicationLoop
    await this.applicationLoop.startMainLoop()
  }

  /**
   * Initialize default provider through StateManager
   */
  async initializeDefaultProvider() {
    // Get available provider keys (with API keys set)
    const availableProviders = Object.entries(PROVIDERS)
      .filter(([, provider]) => process.env[provider.apiKeyEnv])
      .map(([key]) => key)

    if (availableProviders.length === 0) {
      throw new Error('No AI providers available - check your API keys')
    }

    const defaultProvider =  availableProviders[0]

    logger.debug(`Initializing default provider: ${defaultProvider}`)
    await this.stateManager.switchProvider(defaultProvider)
  }

}

async function start() {
  const aiApp = new AIApplication()

  try {
    logger.debug('🚀 Starting Phase 2 AI Application')
    await aiApp.initialize()
    await aiApp.run()
  } catch (error) {
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()
