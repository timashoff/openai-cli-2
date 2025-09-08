/**
 * StateObserver - Observer Pattern for CLI State Management
 * 
 * Monitors and tracks CLI application state changes:
 * - Processing states (request, response, typing)
 * - CLI interaction states (spinner, prompt, input)
 * - Application lifecycle states (initialization, shutdown)
 * - Provider and model states
 * - Error states and recovery
 * 
 * Part of Phase 3: Modern Patterns & Event-Driven Architecture
 */

import { globalEventBus } from '../utils/event-bus.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

/**
 * State Event Types
 */
export const STATE_EVENTS = {
  // Processing states
  REQUEST_PROCESSING_STARTED: 'state:request_processing_started',
  REQUEST_PROCESSING_STOPPED: 'state:request_processing_stopped',
  RESPONSE_TYPING_STARTED: 'state:response_typing_started',
  RESPONSE_TYPING_STOPPED: 'state:response_typing_stopped',
  
  // CLI interaction states
  SPINNER_STARTED: 'state:spinner_started',
  SPINNER_STOPPED: 'state:spinner_stopped',
  PROMPT_ACTIVATED: 'state:prompt_activated',
  PROMPT_DEACTIVATED: 'state:prompt_deactivated',
  INPUT_WAITING: 'state:input_waiting',
  INPUT_RECEIVED: 'state:input_received',
  
  // Application lifecycle
  APP_INITIALIZING: 'state:app_initializing',
  APP_INITIALIZED: 'state:app_initialized',
  APP_READY: 'state:app_ready',
  APP_SHUTTING_DOWN: 'state:app_shutting_down',
  
  // Provider and model states
  PROVIDER_SWITCHING: 'state:provider_switching',
  PROVIDER_SWITCHED: 'state:provider_switched',
  MODEL_SWITCHING: 'state:model_switching',
  MODEL_SWITCHED: 'state:model_switched',
  
  // Error and recovery states
  ERROR_STATE_ENTERED: 'state:error_state_entered',
  ERROR_STATE_CLEARED: 'state:error_state_cleared',
  RECOVERY_STARTED: 'state:recovery_started',
  RECOVERY_COMPLETED: 'state:recovery_completed',
  
  // Context and session states
  CONTEXT_CLEARED: 'state:context_cleared',
  SESSION_RESET: 'state:session_reset',
  CACHE_CLEARED: 'state:cache_cleared',
  
  // Special states
  ESCAPE_KEY_PRESSED: 'state:escape_key_pressed',
  ABORT_REQUESTED: 'state:abort_requested',
  FORCE_FLAG_DETECTED: 'state:force_flag_detected',
  
  // Database events
  DATABASE_COMMAND_ADDED: 'database:command_added',
  DATABASE_COMMAND_UPDATED: 'database:command_updated', 
  DATABASE_COMMAND_DELETED: 'database:command_deleted',
  DATABASE_COMMANDS_CHANGED: 'database:commands_changed'
}

/**
 * CLI State Types
 */
export const CLI_STATES = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  PROCESSING_REQUEST: 'processing_request',
  TYPING_RESPONSE: 'typing_response',
  WAITING_INPUT: 'waiting_input',
  SWITCHING_PROVIDER: 'switching_provider',
  ERROR: 'error',
  SHUTTING_DOWN: 'shutting_down'
}

/**
 * StateObserver class for monitoring application state changes
 */
export class StateObserver {
  constructor() {
    this.eventBus = globalEventBus
    this.subscriptions = new Map()
    this.currentState = CLI_STATES.IDLE
    this.previousState = null
    this.stateHistory = []
    this.stateMetrics = new Map()
    this.stateTimestamps = new Map()
    this.sessionStats = {
      totalStateChanges: 0,
      stateDistribution: {},
      averageStateTime: {},
      longestState: null,
      shortestState: null
    }
    this.isActive = false
    this.startTime = null
  }

  /**
   * Start observing state events




   */
  startObserving(options = {}) {
    if (this.isActive) {
      logger.debug('StateObserver: Already active')
      return
    }

    const { trackMetrics = true, trackHistory = true, debug = false } = options
    this.isActive = true
    this.startTime = Date.now()
    
    logger.debug('StateObserver: Starting state observation with options:', options)

    // Subscribe to all state event categories
    this.subscribeToProcessingEvents(debug)
    this.subscribeToCLIEvents(debug)
    this.subscribeToApplicationEvents(debug)
    this.subscribeToProviderEvents(debug)
    this.subscribeToErrorEvents(debug)
    this.subscribeToSpecialEvents(debug)
    
    // Set initial state
    this.changeState(CLI_STATES.IDLE, { reason: 'observer_started' })
  }

  /**
   * Stop observing and cleanup subscriptions
   */
  stopObserving() {
    if (!this.isActive) return

    const observationTime = Date.now() - this.startTime
    logger.debug(`StateObserver: Stopping observation after ${observationTime}ms`)

    // Calculate final session statistics
    this.calculateSessionStats()

    // Unsubscribe from all events
    for (const subscriptionId of this.subscriptions.values()) {
      this.eventBus.off(subscriptionId)
    }
    
    this.subscriptions.clear()
    this.isActive = false
    
    logger.info('StateObserver: Session completed:', this.sessionStats)
    this.startTime = null
  }

  /**
   * Subscribe to processing state events
   */
  subscribeToProcessingEvents(debug = false) {
    const requestStartedSub = this.eventBus.on(
      STATE_EVENTS.REQUEST_PROCESSING_STARTED,
      (payload) => this.handleRequestProcessingStarted(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('request_started', requestStartedSub)

    const requestStoppedSub = this.eventBus.on(
      STATE_EVENTS.REQUEST_PROCESSING_STOPPED,
      (payload) => this.handleRequestProcessingStopped(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('request_stopped', requestStoppedSub)

    const typingStartedSub = this.eventBus.on(
      STATE_EVENTS.RESPONSE_TYPING_STARTED,
      (payload) => this.handleResponseTypingStarted(payload, debug),
      { priority: 95 }
    )
    this.subscriptions.set('typing_started', typingStartedSub)

    const typingStoppedSub = this.eventBus.on(
      STATE_EVENTS.RESPONSE_TYPING_STOPPED,
      (payload) => this.handleResponseTypingStopped(payload, debug),
      { priority: 95 }
    )
    this.subscriptions.set('typing_stopped', typingStoppedSub)
  }

  /**
   * Subscribe to CLI interaction events
   */
  subscribeToCLIEvents(debug = false) {
    const spinnerStartedSub = this.eventBus.on(
      STATE_EVENTS.SPINNER_STARTED,
      (payload) => this.handleSpinnerStarted(payload, debug),
      { priority: 80 }
    )
    this.subscriptions.set('spinner_started', spinnerStartedSub)

    const spinnerStoppedSub = this.eventBus.on(
      STATE_EVENTS.SPINNER_STOPPED,
      (payload) => this.handleSpinnerStopped(payload, debug),
      { priority: 80 }
    )
    this.subscriptions.set('spinner_stopped', spinnerStoppedSub)

    const inputWaitingSub = this.eventBus.on(
      STATE_EVENTS.INPUT_WAITING,
      (payload) => this.handleInputWaiting(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('input_waiting', inputWaitingSub)
  }

  /**
   * Subscribe to application lifecycle events
   */
  subscribeToApplicationEvents(debug = false) {
    const appInitializingSub = this.eventBus.on(
      STATE_EVENTS.APP_INITIALIZING,
      (payload) => this.handleAppInitializing(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('app_initializing', appInitializingSub)

    const appReadySub = this.eventBus.on(
      STATE_EVENTS.APP_READY,
      (payload) => this.handleAppReady(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('app_ready', appReadySub)
  }

  /**
   * Subscribe to provider state events
   */
  subscribeToProviderEvents(debug = false) {
    const providerSwitchingSub = this.eventBus.on(
      STATE_EVENTS.PROVIDER_SWITCHING,
      (payload) => this.handleProviderSwitching(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('provider_switching', providerSwitchingSub)

    const providerSwitchedSub = this.eventBus.on(
      STATE_EVENTS.PROVIDER_SWITCHED,
      (payload) => this.handleProviderSwitched(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('provider_switched', providerSwitchedSub)
  }

  /**
   * Subscribe to error state events
   */
  subscribeToErrorEvents(debug = false) {
    const errorEnteredSub = this.eventBus.on(
      STATE_EVENTS.ERROR_STATE_ENTERED,
      (payload) => this.handleErrorStateEntered(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('error_entered', errorEnteredSub)

    const errorClearedSub = this.eventBus.on(
      STATE_EVENTS.ERROR_STATE_CLEARED,
      (payload) => this.handleErrorStateCleared(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('error_cleared', errorClearedSub)
  }

  /**
   * Subscribe to special events
   */
  subscribeToSpecialEvents(debug = false) {
    const escapeKeySub = this.eventBus.on(
      STATE_EVENTS.ESCAPE_KEY_PRESSED,
      (payload) => this.handleEscapeKeyPressed(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('escape_key', escapeKeySub)

    const contextClearedSub = this.eventBus.on(
      STATE_EVENTS.CONTEXT_CLEARED,
      (payload) => this.handleContextCleared(payload, debug),
      { priority: 70 }
    )
    this.subscriptions.set('context_cleared', contextClearedSub)
  }

  /**
   * Event handlers
   */
  handleRequestProcessingStarted(payload, debug) {
    if (debug) {
      console.log(`${color.blue}🔄 REQUEST PROCESSING:${color.reset} Started`)
    }
    this.changeState(CLI_STATES.PROCESSING_REQUEST, { reason: 'request_started' })
  }

  handleRequestProcessingStopped(payload, debug) {
    if (debug) {
      console.log(`${color.green}✓ Request processing:${color.reset} stopped`)
    }
    this.changeState(CLI_STATES.IDLE, { reason: 'request_stopped' })
  }

  handleResponseTypingStarted(payload, debug) {
    if (debug) {
      console.log(`${color.cyan}⌨️ RESPONSE TYPING:${color.reset} Started`)
    }
    this.changeState(CLI_STATES.TYPING_RESPONSE, { reason: 'typing_started' })
  }

  handleResponseTypingStopped(payload, debug) {
    if (debug) {
      console.log(`${color.green}📝 RESPONSE TYPING:${color.reset} Completed`)
    }
    this.changeState(CLI_STATES.WAITING_INPUT, { reason: 'typing_stopped' })
  }

  handleSpinnerStarted(payload, debug) {
    const { spinnerType } = payload.data || {}
    if (debug) {
      console.log(`${color.yellow}⏳ SPINNER:${color.reset} Started (${spinnerType || 'default'})`)
    }
  }

  handleSpinnerStopped(payload, debug) {
    if (debug) {
      console.log(`${color.green}⏹️ SPINNER:${color.reset} Stopped`)
    }
  }

  handleInputWaiting(payload, debug) {
    if (debug) {
      console.log(`${color.blue}⌛ INPUT:${color.reset} Waiting for user input`)
    }
    this.changeState(CLI_STATES.WAITING_INPUT, { reason: 'waiting_input' })
  }

  handleAppInitializing(payload, debug) {
    if (debug) {
      console.log(`${color.magenta}🚀 APP:${color.reset} Initializing`)
    }
    this.changeState(CLI_STATES.INITIALIZING, { reason: 'app_initializing' })
  }

  handleAppReady(payload, debug) {
    if (debug) {
      console.log(`${color.green}✓ App:${color.reset} ready`)
    }
    this.changeState(CLI_STATES.IDLE, { reason: 'app_ready' })
  }

  handleProviderSwitching(payload, debug) {
    const { fromProvider, toProvider } = payload.data || {}
    if (debug) {
      console.log(`${color.purple}🔄 PROVIDER:${color.reset} Switching ${fromProvider} → ${toProvider}`)
    }
    this.changeState(CLI_STATES.SWITCHING_PROVIDER, { reason: 'provider_switching' })
  }

  handleProviderSwitched(payload, debug) {
    const { provider } = payload.data || {}
    if (debug) {
      console.log(`${color.green}✓ Provider:${color.reset} switched to ${provider}`)
    }
    this.changeState(CLI_STATES.IDLE, { reason: 'provider_switched' })
  }

  handleErrorStateEntered(payload, debug) {
    const { error, context } = payload.data || {}
    if (debug) {
      console.log(`${color.red}✗ Error state:${color.reset} ${error} (${context})`)
    }
    this.changeState(CLI_STATES.ERROR, { reason: 'error_occurred', error, context })
  }

  handleErrorStateCleared(payload, debug) {
    if (debug) {
      console.log(`${color.green}🔧 ERROR STATE:${color.reset} Cleared`)
    }
    this.changeState(CLI_STATES.IDLE, { reason: 'error_cleared' })
  }

  handleEscapeKeyPressed(payload, debug) {
    const { context } = payload.data || {}
    if (debug) {
      console.log(`${color.yellow}⏸️ ESCAPE KEY:${color.reset} Pressed (${context})`)
    }
  }

  handleContextCleared(payload, debug) {
    if (debug) {
      console.log(`${color.grey}🗑️ CONTEXT:${color.reset} Cleared`)
    }
  }

  /**
   * Change application state


   */
  changeState(newState, context = {}) {
    if (newState === this.currentState) {
      return // No change
    }

    const previousState = this.currentState
    const timestamp = Date.now()
    
    // Calculate time in previous state
    if (this.stateTimestamps.has(this.currentState)) {
      const timeInState = timestamp - this.stateTimestamps.get(this.currentState)
      this.recordStateMetric(this.currentState, timeInState)
    }

    // Update state
    this.previousState = this.currentState
    this.currentState = newState
    this.stateTimestamps.set(newState, timestamp)
    
    // Track in history
    this.stateHistory.push({
      from: previousState,
      to: newState,
      timestamp,
      context
    })
    
    // Update session stats
    this.sessionStats.totalStateChanges++
    
    logger.debug(`StateObserver: State change: ${previousState} → ${newState}`, context)
    
    // Note: State change events are already emitted by CLIManager via emitStateEvent()
    // No need to emit duplicate 'state:changed' event here to avoid circular detection
  }

  /**
   * Record state timing metric


   */
  recordStateMetric(state, duration) {
    if (!this.stateMetrics.has(state)) {
      this.stateMetrics.set(state, [])
    }
    
    this.stateMetrics.get(state).push(duration)
  }

  /**
   * Calculate session statistics
   */
  calculateSessionStats() {
    // Calculate state distribution
    for (const [state, durations] of this.stateMetrics.entries()) {
      const totalTime = durations.reduce((sum, d) => sum + d, 0)
      const averageTime = totalTime / durations.length
      
      this.sessionStats.stateDistribution[state] = {
        count: durations.length,
        totalTime,
        averageTime,
        minTime: Math.min(...durations),
        maxTime: Math.max(...durations)
      }
      
      this.sessionStats.averageStateTime[state] = averageTime
      
      // Track longest and shortest states
      if (!this.sessionStats.longestState || averageTime > this.sessionStats.averageStateTime[this.sessionStats.longestState]) {
        this.sessionStats.longestState = state
      }
      
      if (!this.sessionStats.shortestState || averageTime < this.sessionStats.averageStateTime[this.sessionStats.shortestState]) {
        this.sessionStats.shortestState = state
      }
    }
  }

  /**
   * Emit a state event



   */
  emit(eventType, data, options = {}) {
    if (!this.isActive && !eventType.includes('app_initializing')) {
      return // Don't emit if not observing (except for initialization)
    }

    this.eventBus.emitSync(eventType, data, {
      source: 'StateObserver',
      ...options
    })
  }

  /**
   * Get current state

   */
  getCurrentState() {
    return this.currentState
  }

  /**
   * Get state history

   */
  getStateHistory() {
    return [...this.stateHistory]
  }

  /**
   * Get session statistics

   */
  getSessionStats() {
    return {
      ...this.sessionStats,
      currentState: this.currentState,
      previousState: this.previousState,
      observationDuration: this.startTime ? Date.now() - this.startTime : 0,
      stateHistoryLength: this.stateHistory.length,
      isActive: this.isActive
    }
  }

  /**
   * Check if observer is active

   */
  get active() {
    return this.isActive
  }
}

// Export singleton instance for global usage
export const stateObserver = new StateObserver()

/**
 * Convenience function to start observing with common options


 */
export function startStateObserver(options = {}) {
  stateObserver.startObserving(options)
  return stateObserver
}

/**
 * Convenience function to stop observing

 */
export function stopStateObserver() {
  const stats = stateObserver.getSessionStats()
  stateObserver.stopObserving()
  return stats
}

/**
 * Convenience function to get current state

 */
export function getCurrentState() {
  return stateObserver.getCurrentState()
}

/**
 * Convenience function to emit state events


 */
export function emitStateEvent(eventType, data = {}) {
  stateObserver.emit(eventType, data)
}