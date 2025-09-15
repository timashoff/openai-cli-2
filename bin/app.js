#!/usr/bin/env node
import { logger } from '../utils/logger.js'
import { outputHandler } from '../core/print/output.js'
import { errorHandler } from '../core/error-system/index.js'
import { Router } from '../core/Router.js'
import { createApplicationLoop } from '../core/application-loop.js'
import { createChatHandler } from '../core/chat-handler.js'
import { createSingleModelCommand } from '../commands/single-model-command.js'
import { multiModelCommand } from '../commands/multi-model-command.js'
import { systemCommandHandler } from '../core/system-command-handler.js'
import { getStateManager } from '../core/StateManager.js'
import { PROVIDERS } from '../config/providers.js'

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

    // Create application context for components that need it
    const appContext = { stateManager }

    // Create dependent components through functional composition
    const chatHandler = createChatHandler(appContext)
    const singleModelCommand = createSingleModelCommand(appContext)
    const applicationLoop = createApplicationLoop(appContext)

    // Create router with all handler dependencies
    const router = new Router({
      systemCommandHandler,
      multiModelCommand,
      singleModelCommand,
      chatHandler,
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
    const currentModel = stateManager.getCurrentModel()
    console.log(outputHandler.formatInfo(`current model is ${currentModel}`))

    process.title = stateManager.getCurrentModel()

    // Start main application loop
    await applicationLoop.startMainLoop()
  } catch (error) {
    errorHandler.handleError(error, {
      context: 'application_start',
      fatal: true,
    })
    process.exit(1)
  }
}

start()
