#!/usr/bin/env node
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../core/error-system/index.js'
import { Router } from '../core/Router.js'
import { ApplicationLoop } from '../core/ApplicationLoop.js'
import { createChatRequest } from '../core/ChatRequest.js'
import { createCommandHandler } from '../core/CommandHandler.js'
import { systemCommandHandler } from '../core/system-command-handler.js'
import { CacheManager } from '../core/CacheManager.js'
import { getStateManager } from '../core/StateManager.js'
import { APP_CONFIG } from '../config/app-config.js'

const PROVIDERS = APP_CONFIG.PROVIDERS

async function initializeDefaultProvider(stateManager) {
  // Get available provider keys (with API keys set)
  const availableProviders = Object.entries(PROVIDERS)
    .filter(([, provider]) => process.env[provider.apiKeyEnv])
    .map(([key]) => key)

  if (availableProviders.length === 0) {
    throw new Error('No AI providers available - check your API keys')
  }

  const defaultProvider = availableProviders[0]

  logger.debug(`Initializing default provider: ${defaultProvider}`)
  await stateManager.switchProvider(defaultProvider)
}

async function start() {
  try {
    logger.debug('🚀 Starting AI Application - Pure Functional Style')

    // Initialize core components through composition
    const stateManager = getStateManager()
    const cacheManager = new CacheManager()
    const systemCommandHandler_instance = systemCommandHandler

    // Create application context for components that need it
    const appContext = { stateManager }

    // Create dependent components through functional composition
    const chatRequest = createChatRequest(appContext)
    const commandHandler = createCommandHandler(chatRequest, cacheManager)
    const applicationLoop = new ApplicationLoop(appContext)

    // Create router with all handler dependencies
    const router = new Router({
      systemCommandHandler: systemCommandHandler_instance,
      commandHandler: commandHandler,
      chatRequest: chatRequest
    })

    // Add router to context for ApplicationLoop
    appContext.router = router

    // Initialize providers with ApplicationLoop spinner
    await applicationLoop.showInitializationSpinner(async () => {
      // Initialize default provider through StateManager
      await initializeDefaultProvider(stateManager)
      // Initialize router if needed
      await router.initialize()
    })

    // Show current model info after spinner cleanup
    const currentProvider = stateManager.getCurrentProvider()
    const currentModel = stateManager.getCurrentModel()
    if (currentProvider && currentModel) {
      console.log(`current model is ${currentProvider.instance.config.name} ${currentModel}`)
    }

    // Set process title
    process.title = stateManager.getCurrentModel()

    // Start main application loop
    await applicationLoop.startMainLoop()

  } catch (error) {
    console.error(`${color.red}Error: Application startup failed: ${error.message}${color.reset}`)
    errorHandler.handleError(error, { context: 'application_start', fatal: true })
    process.exit(1)
  }
}

start()