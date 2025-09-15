import { getStateManager } from '../StateManager.js'
import { createSpinner } from '../../utils/spinner.js'
import { createReadlineManager } from './readline-manager.js'
import { createInputProcessor } from './input-processor.js'
import { createLifecycleManager } from './lifecycle-manager.js'
import { createKeypressHandler } from './keypress-handler.js'
import { createMainLoop } from './main-loop.js'

export const createApplicationLoop = (app) => {
  // Get StateManager instance
  const stateManager = getStateManager()

  // State (functional closures instead of class properties)
  const state = {
    app,
    stateManager,
    readlineManager: null, // Will be initialized after handleInterrupt is defined
    inputProcessor: null, // Will be initialized with stateManager
    lifecycleManager: null, // Will be initialized with state
    keypressHandler: null, // Will be initialized with state
    mainLoop: null, // Will be initialized with state and applicationLoopInstance
    escHandlers: new Map(),
    currentEscHandler: null,
    handlerIdCounter: 0,
    screenWasCleared: false,
    keypressEnabled: false,
    isExiting: false,
    currentEscapeResolve: null,
    globalKeyPressHandler: null,
  }

  const showInitializationSpinner = async (callback) => {
    const spinner = createSpinner('Loading AI providers...')
    spinner.start()

    try {
      // Execute callback
      await callback()

      // Show success
      spinner.stop('success')

      return spinner.getElapsed()
    } catch (error) {
      // Show failure
      spinner.stop('error')
      throw error
    }
  }

  // Forward declaration for applicationLoopInstance
  const applicationLoopInstance = {}

  // Create lifecycle manager first (needed for handleInterrupt)
  state.lifecycleManager = createLifecycleManager(state)

  // Create keypress handler
  state.keypressHandler = createKeypressHandler(state)

  // Create readline manager with lifecycle manager's handleInterrupt
  state.readlineManager = createReadlineManager(
    state.lifecycleManager.handleInterrupt,
  )

  // Create input processor
  state.inputProcessor = createInputProcessor(stateManager)

  // Initialize the ApplicationLoop and setup
  state.keypressHandler.setupEscapeKeyHandling()
  state.lifecycleManager.setupCleanupHandlers()

  // Create main loop after applicationLoopInstance is declared (needs reference to it)
  state.mainLoop = createMainLoop(state, applicationLoopInstance)

  // Populate the instance object with all methods
  Object.assign(applicationLoopInstance, {
    // Core loop functionality
    startMainLoop: state.mainLoop.startMainLoop,
    exitApp: state.lifecycleManager.exitApp,

    // App context accessor (for system commands)
    get app() {
      return state.app
    },

    // Readline management
    pauseReadline: state.readlineManager.pauseReadline,
    resumeReadline: state.readlineManager.resumeReadline,

    // ESC handling system
    registerEscHandler: state.keypressHandler.registerEscHandler,
    unregisterEscHandler: state.keypressHandler.unregisterEscHandler,
    clearAllEscHandlers: state.keypressHandler.clearAllEscHandlers,
    getEscHandlers: state.keypressHandler.getEscHandlers,

    // Keypress management
    enableKeypressEvents: state.keypressHandler.enableKeypressEvents,

    // Spinner functionality (using utils/spinner.js)
    showInitializationSpinner,

    // UI interfaces for commands
    ui: {
      get readline() {
        return state.readlineManager.getReadlineInterface()
      },
      exitApp: () => state.lifecycleManager.exitApp(),
      pauseReadline: () => state.readlineManager.pauseReadline(),
      resumeReadline: () => state.readlineManager.resumeReadline(),
    },
  })

  return applicationLoopInstance
}
