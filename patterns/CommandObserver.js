/**
 * CommandObserver - Observer Pattern for Command Lifecycle Tracking
 * 
 * Tracks the complete lifecycle of command execution:
 * - Command parsing and validation
 * - Database lookups and cache hits
 * - Execution start/completion
 * - Performance metrics
 * - Error handling
 * 
 * Part of Phase 3: Modern Patterns & Event-Driven Architecture
 */

import { globalEventBus } from '../utils/event-bus.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

/**
 * Command Event Types
 */
export const COMMAND_EVENTS = {
  // Input processing
  INPUT_RECEIVED: 'command:input_received',
  INPUT_VALIDATED: 'command:input_validated',
  INPUT_SANITIZED: 'command:input_sanitized',
  
  // Command detection and parsing
  COMMAND_DETECTED: 'command:command_detected',
  COMMAND_PARSED: 'command:command_parsed',
  COMMAND_NOT_FOUND: 'command:command_not_found',
  
  // Database operations
  DB_LOOKUP_STARTED: 'command:db_lookup_started',
  DB_LOOKUP_COMPLETED: 'command:db_lookup_completed',
  DB_COMMAND_FOUND: 'command:db_command_found',
  
  // Cache operations
  CACHE_HIT: 'command:cache_hit',
  CACHE_MISS: 'command:cache_miss',
  CACHE_STORED: 'command:cache_stored',
  
  // Command execution
  COMMAND_STARTED: 'command:command_started',
  COMMAND_COMPLETED: 'command:command_completed',
  COMMAND_FAILED: 'command:command_failed',
  COMMAND_CANCELLED: 'command:command_cancelled',
  
  // System commands
  SYSTEM_COMMAND_EXECUTED: 'command:system_command_executed',
  AI_COMMAND_EXECUTED: 'command:ai_command_executed',
  
  // Multi-model commands
  MULTI_COMMAND_STARTED: 'command:multi_command_started',
  MULTI_COMMAND_COMPLETED: 'command:multi_command_completed',
  
  // Performance metrics
  COMMAND_LATENCY: 'command:latency_measured',
  COMMAND_THROUGHPUT: 'command:throughput_measured',
  
  // MCP operations
  MCP_PROCESSING_STARTED: 'command:mcp_processing_started',
  MCP_PROCESSING_COMPLETED: 'command:mcp_processing_completed'
}

/**
 * CommandObserver class for monitoring command execution
 */
export class CommandObserver {
  constructor() {
    this.eventBus = globalEventBus
    this.subscriptions = new Map()
    this.commandMetrics = new Map()
    this.sessionStats = {
      totalCommands: 0,
      successfulCommands: 0,
      failedCommands: 0,
      cacheHits: 0,
      averageLatency: 0,
      totalExecutionTime: 0
    }
    this.isActive = false
    this.startTime = null
  }

  /**
   * Start observing command events
   * @param {Object} options - Observer options
   * @param {boolean} options.trackMetrics - Track performance metrics
   * @param {boolean} options.trackCache - Track cache operations
   * @param {boolean} options.debug - Enable debug logging
   */
  startObserving(options = {}) {
    if (this.isActive) {
      logger.debug('CommandObserver: Already active')
      return
    }

    const { trackMetrics = true, trackCache = true, debug = false } = options
    this.isActive = true
    this.startTime = Date.now()
    
    logger.debug('CommandObserver: Starting command observation with options:', options)

    // Subscribe to command lifecycle events
    this.subscribeToInputEvents(debug)
    this.subscribeToCommandDetectionEvents(debug)
    this.subscribeToExecutionEvents(debug)
    this.subscribeToSystemEvents(debug)
    
    if (trackCache) {
      this.subscribeToCacheEvents(debug)
    }
    
    if (trackMetrics) {
      this.subscribeToPerformanceEvents()
    }
  }

  /**
   * Stop observing and cleanup subscriptions
   */
  stopObserving() {
    if (!this.isActive) return

    const observationTime = Date.now() - this.startTime
    logger.debug(`CommandObserver: Stopping observation after ${observationTime}ms`)

    // Unsubscribe from all events
    for (const subscriptionId of this.subscriptions.values()) {
      this.eventBus.off(subscriptionId)
    }
    
    this.subscriptions.clear()
    this.isActive = false
    
    // Calculate final session stats
    if (this.sessionStats.totalCommands > 0) {
      this.sessionStats.averageLatency = 
        this.sessionStats.totalExecutionTime / this.sessionStats.totalCommands
    }
    
    logger.info('CommandObserver: Session completed:', this.sessionStats)
    this.startTime = null
  }

  /**
   * Subscribe to input processing events
   */
  subscribeToInputEvents(debug = false) {
    const inputReceivedSub = this.eventBus.on(
      COMMAND_EVENTS.INPUT_RECEIVED,
      (payload) => this.handleInputReceived(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('input_received', inputReceivedSub)

    const inputValidatedSub = this.eventBus.on(
      COMMAND_EVENTS.INPUT_VALIDATED,
      (payload) => this.handleInputValidated(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('input_validated', inputValidatedSub)
  }

  /**
   * Subscribe to command detection events
   */
  subscribeToCommandDetectionEvents(debug = false) {
    const commandDetectedSub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_DETECTED,
      (payload) => this.handleCommandDetected(payload, debug),
      { priority: 95 }
    )
    this.subscriptions.set('command_detected', commandDetectedSub)

    const commandParsedSub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_PARSED,
      (payload) => this.handleCommandParsed(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('command_parsed', commandParsedSub)

    const dbLookupSub = this.eventBus.on(
      COMMAND_EVENTS.DB_LOOKUP_COMPLETED,
      (payload) => this.handleDbLookupCompleted(payload, debug),
      { priority: 85 }
    )
    this.subscriptions.set('db_lookup', dbLookupSub)
  }

  /**
   * Subscribe to execution events
   */
  subscribeToExecutionEvents(debug = false) {
    const commandStartedSub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_STARTED,
      (payload) => this.handleCommandStarted(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('command_started', commandStartedSub)

    const commandCompletedSub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_COMPLETED,
      (payload) => this.handleCommandCompleted(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('command_completed', commandCompletedSub)

    const commandFailedSub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_FAILED,
      (payload) => this.handleCommandFailed(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('command_failed', commandFailedSub)
  }

  /**
   * Subscribe to system command events
   */
  subscribeToSystemEvents(debug = false) {
    const systemCommandSub = this.eventBus.on(
      COMMAND_EVENTS.SYSTEM_COMMAND_EXECUTED,
      (payload) => this.handleSystemCommand(payload, debug),
      { priority: 80 }
    )
    this.subscriptions.set('system_command', systemCommandSub)

    const aiCommandSub = this.eventBus.on(
      COMMAND_EVENTS.AI_COMMAND_EXECUTED,
      (payload) => this.handleAICommand(payload, debug),
      { priority: 80 }
    )
    this.subscriptions.set('ai_command', aiCommandSub)
  }

  /**
   * Subscribe to cache events
   */
  subscribeToCacheEvents(debug = false) {
    const cacheHitSub = this.eventBus.on(
      COMMAND_EVENTS.CACHE_HIT,
      (payload) => this.handleCacheHit(payload, debug),
      { priority: 70 }
    )
    this.subscriptions.set('cache_hit', cacheHitSub)

    const cacheMissSub = this.eventBus.on(
      COMMAND_EVENTS.CACHE_MISS,
      (payload) => this.handleCacheMiss(payload, debug),
      { priority: 70 }
    )
    this.subscriptions.set('cache_miss', cacheMissSub)
  }

  /**
   * Subscribe to performance events
   */
  subscribeToPerformanceEvents() {
    const latencySub = this.eventBus.on(
      COMMAND_EVENTS.COMMAND_LATENCY,
      (payload) => this.handleCommandLatency(payload),
      { priority: 60 }
    )
    this.subscriptions.set('latency', latencySub)
  }

  /**
   * Event handlers
   */
  handleInputReceived(payload, debug) {
    const { input, length, hasClipboard, hasForceFlag } = payload.data
    
    if (debug) {
      console.log(`${color.blue}📥 INPUT:${color.reset} "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}" (${length} chars)`)
      if (hasClipboard) console.log(`${color.yellow}📋 Clipboard content detected${color.reset}`)
      if (hasForceFlag) console.log(`${color.yellow}🔄 Force flag detected${color.reset}`)
    }
    
    this.commandMetrics.set('last_input', {
      input,
      length,
      hasClipboard,
      hasForceFlag,
      timestamp: payload.timestamp
    })
  }

  handleInputValidated(payload, debug) {
    const { isValid, errors } = payload.data
    
    if (debug && !isValid) {
      console.log(`${color.red}❌ INPUT VALIDATION FAILED:${color.reset} ${errors.join(', ')}`)
    }
  }

  handleCommandDetected(payload, debug) {
    const { commandKey, commandType, isSystemCommand, isAICommand } = payload.data
    
    if (debug) {
      const type = isSystemCommand ? 'SYSTEM' : isAICommand ? 'AI' : 'DATABASE'
      console.log(`${color.green}🔍 COMMAND DETECTED:${color.reset} ${commandKey} (${type})`)
    }
    
    this.commandMetrics.set('last_detection', {
      commandKey,
      commandType,
      isSystemCommand,
      isAICommand,
      timestamp: payload.timestamp
    })
  }

  handleCommandParsed(payload, debug) {
    const { command, hasMultipleModels, isTranslation, hasUrl } = payload.data
    
    if (debug) {
      console.log(`${color.cyan}📋 COMMAND PARSED:${color.reset} ${command.commandType}`)
      if (hasMultipleModels) console.log(`${color.magenta}🔄 Multi-model command${color.reset}`)
      if (isTranslation) console.log(`${color.yellow}🔤 Translation command${color.reset}`)
      if (hasUrl) console.log(`${color.blue}🌐 URL detected${color.reset}`)
    }
  }

  handleDbLookupCompleted(payload, debug) {
    const { found, commandsCount, lookupTime } = payload.data
    
    if (debug) {
      console.log(`${color.green}🗄️ DB LOOKUP:${color.reset} ${found ? 'Found' : 'Not found'} (${lookupTime}ms, ${commandsCount} commands)`)
    }
  }

  handleCommandStarted(payload, debug) {
    const { commandKey, commandType, isMultiModel } = payload.data
    
    if (debug) {
      const type = isMultiModel ? 'MULTI-MODEL' : 'SINGLE'
      console.log(`${color.green}🚀 COMMAND STARTED:${color.reset} ${commandKey} (${type})`)
    }
    
    this.sessionStats.totalCommands++
    this.commandMetrics.set(`execution_start_${commandKey}`, {
      commandKey,
      commandType,
      isMultiModel,
      startTime: Date.now(),
      timestamp: payload.timestamp
    })
  }

  handleCommandCompleted(payload, debug) {
    const { commandKey, duration, success, responseLength } = payload.data
    
    if (debug) {
      console.log(`${color.green}✅ COMMAND COMPLETED:${color.reset} ${commandKey} (${duration}ms, ${responseLength} chars)`)
    }
    
    if (success) {
      this.sessionStats.successfulCommands++
    }
    
    this.sessionStats.totalExecutionTime += duration
    
    this.commandMetrics.set(`execution_result_${commandKey}`, {
      commandKey,
      duration,
      success,
      responseLength,
      timestamp: payload.timestamp
    })
  }

  handleCommandFailed(payload, debug) {
    const { commandKey, error, duration } = payload.data
    
    if (debug) {
      console.log(`${color.red}❌ COMMAND FAILED:${color.reset} ${commandKey} - ${error} (${duration}ms)`)
    }
    
    this.sessionStats.failedCommands++
    
    if (duration) {
      this.sessionStats.totalExecutionTime += duration
    }
  }

  handleSystemCommand(payload, debug) {
    const { commandName, args, success } = payload.data
    
    if (debug) {
      console.log(`${color.blue}⚙️ SYSTEM COMMAND:${color.reset} ${commandName} ${args ? `(${args.join(' ')})` : ''}`)
    }
  }

  handleAICommand(payload, debug) {
    const { commandName, provider, model } = payload.data
    
    if (debug) {
      console.log(`${color.purple}🤖 AI COMMAND:${color.reset} ${commandName} (${provider}/${model})`)
    }
  }

  handleCacheHit(payload, debug) {
    const { cacheKey, cacheType, responseLength } = payload.data
    
    if (debug) {
      console.log(`${color.yellow}💾 CACHE HIT:${color.reset} ${cacheType} (${responseLength} chars)`)
    }
    
    this.sessionStats.cacheHits++
  }

  handleCacheMiss(payload, debug) {
    const { cacheKey, cacheType } = payload.data
    
    if (debug) {
      console.log(`${color.grey}🔍 CACHE MISS:${color.reset} ${cacheType}`)
    }
  }

  handleCommandLatency(payload) {
    const { commandKey, phase, latency } = payload.data
    
    this.commandMetrics.set(`latency_${commandKey}_${phase}`, {
      latency,
      timestamp: payload.timestamp
    })
    
    logger.debug(`CommandObserver: Latency measured: ${commandKey} ${phase} = ${latency}ms`)
  }

  /**
   * Emit a command event
   * @param {string} eventType - Event type from COMMAND_EVENTS
   * @param {any} data - Event data
   * @param {Object} options - Additional options
   */
  emit(eventType, data, options = {}) {
    if (!this.isActive && !eventType.includes('input_received')) {
      return // Don't emit if not observing (except for input events)
    }

    this.eventBus.emitSync(eventType, data, {
      source: 'CommandObserver',
      ...options
    })
  }

  /**
   * Get session statistics
   * @returns {Object} Session stats
   */
  getSessionStats() {
    return {
      ...this.sessionStats,
      observationDuration: this.startTime ? Date.now() - this.startTime : 0,
      successRate: this.sessionStats.totalCommands > 0 
        ? (this.sessionStats.successfulCommands / this.sessionStats.totalCommands * 100).toFixed(2) + '%'
        : '0%',
      cacheHitRate: this.sessionStats.totalCommands > 0
        ? (this.sessionStats.cacheHits / this.sessionStats.totalCommands * 100).toFixed(2) + '%'
        : '0%',
      isActive: this.isActive
    }
  }

  /**
   * Get collected metrics
   * @returns {Object} Metrics data
   */
  getMetrics() {
    return {
      sessionStats: this.getSessionStats(),
      commandMetrics: Object.fromEntries(this.commandMetrics),
      subscriptionsCount: this.subscriptions.size
    }
  }

  /**
   * Check if observer is active
   * @returns {boolean} Active status
   */
  get active() {
    return this.isActive
  }
}

// Export singleton instance for global usage
export const commandObserver = new CommandObserver()

/**
 * Convenience function to start observing with common options
 * @param {Object} options - Observer options
 * @returns {CommandObserver} Observer instance
 */
export function startCommandObserver(options = {}) {
  commandObserver.startObserving(options)
  return commandObserver
}

/**
 * Convenience function to stop observing
 * @returns {Object} Final session stats
 */
export function stopCommandObserver() {
  const stats = commandObserver.getSessionStats()
  commandObserver.stopObserving()
  return stats
}