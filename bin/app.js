#!/usr/bin/env node
import pkg from '../package.json' with { type: 'json' }
import { logger } from '../utils/logger.js'
import { outputHandler } from '../core/print/index.js'
import { errorHandler } from '../core/error-system/index.js'
import { createRouter } from '../core/Router.js'
import { createApplicationLoop } from '../core/application-loop/index.js'
import {
  createSingleModelCommand,
  createMultiModelCommand,
  createChatHandler,
} from '../core/response/index.js'
import { systemCommandHandler } from '../core/system-command-handler.js'
import { getStateManager, stateManagerEvents } from '../core/StateManager.js'
import { commandService } from '../services/commands/index.js'
import { configService } from '../services/config/index.js'
import { getSystemCommand } from '../utils/system-commands.js'
import { syncCommands } from '../services/commands/sync.js'
import { syncSessions } from '../services/sessions/sync.js'

async function initializeDefaultProvider(stateManager) {
  // Providers usable via an env API key OR a configured gateway token.
  const availableProviders = configService.availableProviders()

  if (availableProviders.length === 0) {
    throw new Error('No AI providers available - set an API key or a gateway token')
  }

  const defaultProvider = availableProviders[0]

  logger.debug(`Initializing default provider: ${defaultProvider}`)
  await stateManager.switchProvider(defaultProvider)
}

async function start() {
  try {
    logger.debug('🚀 Starting AI Application - Pure Functional Style')

    // Ensure the user commands file exists (migrate legacy db once, or copy defaults)
    await commandService.bootstrap()

    // Ensure the user config file exists and load provider overrides (gateway baseURL/token)
    await configService.bootstrap()

    // Initialize core components through composition
    const stateManager = getStateManager()

    // Setup Event-Driven AbortSignal management (Single Source of Truth)
    stateManagerEvents.on('abort-signal-changed', (signal) => {
      outputHandler.setAbortSignal(signal)
      logger.debug('Event-Driven: AbortSignal updated in outputHandler')
    })

    // Create application context for components that need it
    const appContext = { stateManager }

    // Create dependent components through functional composition
    const chatHandler = createChatHandler(appContext)
    const singleModelCommand = createSingleModelCommand(appContext)
    const applicationLoop = createApplicationLoop(appContext)

    // Create router with all handler dependencies
    const multiModelCommand = createMultiModelCommand()
    const router = createRouter({
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

    // Background: pull the account's latest synced commands and sessions
    // (non-blocking; applies newer account versions). No-op if not logged in.
    syncCommands().catch(() => {})
    syncSessions().catch(() => {})

    // Show version + release date and current model after spinner cleanup —
    // makes a stale install on another machine obvious at a glance.
    console.log(outputHandler.formatInfo(`${pkg.name} v${pkg.version} · released ${pkg.releaseDate}`))
    const currentModel = stateManager.getCurrentModel()
    console.log(outputHandler.formatInfo(`current model is ${currentModel}`))

    process.title = stateManager.getCurrentModel()

    // Start main application loop
    await applicationLoop.startMainLoop()
  } catch (error) {
    await errorHandler.handleError(error, {
      context: 'application_start',
      fatal: true,
    })
    process.exit(1)
  }
}

async function main() {
  const argv = process.argv.slice(2)

  // Onboarding/auth commands (login/logout) run headless before anything else —
  // they need no provider and must work from a plain shell.
  const sys = argv.length > 0 ? getSystemCommand(argv[0].toLowerCase()) : null
  if (sys && sys.oneShot) {
    const { runHeadless } = await import('../core/system-command-handler.js')
    process.exit(await runHeadless(sys, argv.slice(1)))
  }

  // One-shot mode: "ai rr text" or piped stdin. Skips the REPL and readline entirely.
  if (argv.length > 0 || !process.stdin.isTTY) {
    const { runOneShot } = await import('../core/oneshot/index.js')
    process.exit(await runOneShot(argv))
  }

  await start()
}

main()
