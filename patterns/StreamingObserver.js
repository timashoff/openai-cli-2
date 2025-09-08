/**
 * StreamingObserver - Observer Pattern for Real-time Streaming Events
 * 
 * Handles real-time events during AI model response streaming:
 * - Chunk arrival notifications
 * - Model completion events  
 * - Streaming state changes
 * - Performance metrics
 * 
 * Part of Phase 3: Modern Patterns & Event-Driven Architecture
 */

import { globalEventBus } from '../utils/event-bus.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

/**
 * Streaming Event Types
 */
export const STREAMING_EVENTS = {
  // Chunk events
  CHUNK_RECEIVED: 'streaming:chunk_received',
  FIRST_CHUNK: 'streaming:first_chunk',
  LAST_CHUNK: 'streaming:last_chunk',
  
  // Model events  
  MODEL_STARTED: 'streaming:model_started',
  MODEL_COMPLETED: 'streaming:model_completed',
  MODEL_ERROR: 'streaming:model_error',
  
  // Stream state events
  STREAM_STARTED: 'streaming:stream_started', 
  STREAM_PAUSED: 'streaming:stream_paused',
  STREAM_RESUMED: 'streaming:stream_resumed',
  STREAM_CANCELLED: 'streaming:stream_cancelled',
  STREAM_FINISHED: 'streaming:stream_finished',
  
  // Multi-model events
  MULTI_STREAM_STARTED: 'streaming:multi_started',
  MULTI_MODEL_QUEUED: 'streaming:multi_queued',
  MULTI_LEADERBOARD_UPDATED: 'streaming:leaderboard_updated',
  MULTI_STREAM_FINISHED: 'streaming:multi_finished',
  
  // Performance events
  PERFORMANCE_METRIC: 'streaming:performance_metric',
  LATENCY_MEASURED: 'streaming:latency_measured'
}

/**
 * StreamingObserver class for monitoring and reacting to streaming events
 */
export class StreamingObserver {
  constructor() {
    this.eventBus = globalEventBus
    this.subscriptions = new Map()
    this.metrics = new Map()
    this.isActive = false
    this.startTime = null
  }

  /**
   * Start observing streaming events



   */
  startObserving(options = {}) {
    if (this.isActive) {
      logger.debug('StreamingObserver: Already active')
      return
    }

    const { trackMetrics = true, debug = false } = options
    this.isActive = true
    this.startTime = Date.now()
    
    logger.debug('StreamingObserver: Starting observation with options:', options)

    // Subscribe to all streaming events with high priority
    this.subscribeToChunkEvents(debug)
    this.subscribeToModelEvents(debug)
    this.subscribeToStreamStateEvents(debug)
    this.subscribeToMultiModelEvents(debug)
    
    if (trackMetrics) {
      this.subscribeToPerformanceEvents()
    }

    this.emit(STREAMING_EVENTS.STREAM_STARTED, {
      observerStartTime: this.startTime,
      options
    })
  }

  /**
   * Stop observing and cleanup subscriptions
   */
  stopObserving() {
    if (!this.isActive) return

    logger.debug(`StreamingObserver: Stopping observation after ${Date.now() - this.startTime}ms`)

    // Unsubscribe from all events
    for (const subscriptionId of this.subscriptions.values()) {
      this.eventBus.off(subscriptionId)
    }
    
    this.subscriptions.clear()
    this.isActive = false
    
    this.emit(STREAMING_EVENTS.STREAM_FINISHED, {
      totalObservationTime: Date.now() - this.startTime,
      metricsCollected: this.metrics.size
    })
    
    this.metrics.clear()
    this.startTime = null
  }

  /**
   * Subscribe to chunk-related events
   */
  subscribeToChunkEvents(debug = false) {
    // First chunk received - critical for timing
    const firstChunkSub = this.eventBus.on(
      STREAMING_EVENTS.FIRST_CHUNK,
      (payload) => this.handleFirstChunk(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('first_chunk', firstChunkSub)

    // Chunk received - for real-time processing
    const chunkSub = this.eventBus.on(
      STREAMING_EVENTS.CHUNK_RECEIVED,
      (payload) => this.handleChunkReceived(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('chunk_received', chunkSub)

    // Last chunk - for completion handling
    const lastChunkSub = this.eventBus.on(
      STREAMING_EVENTS.LAST_CHUNK,
      (payload) => this.handleLastChunk(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('last_chunk', lastChunkSub)
  }

  /**
   * Subscribe to model lifecycle events
   */
  subscribeToModelEvents(debug = false) {
    // Model started
    const modelStartedSub = this.eventBus.on(
      STREAMING_EVENTS.MODEL_STARTED,
      (payload) => this.handleModelStarted(payload, debug),
      { priority: 95 }
    )
    this.subscriptions.set('model_started', modelStartedSub)

    // Model completed
    const modelCompletedSub = this.eventBus.on(
      STREAMING_EVENTS.MODEL_COMPLETED,
      (payload) => this.handleModelCompleted(payload, debug),
      { priority: 95 }
    )
    this.subscriptions.set('model_completed', modelCompletedSub)

    // Model error
    const modelErrorSub = this.eventBus.on(
      STREAMING_EVENTS.MODEL_ERROR,
      (payload) => this.handleModelError(payload, debug),
      { priority: 100 }
    )
    this.subscriptions.set('model_error', modelErrorSub)
  }

  /**
   * Subscribe to stream state events
   */
  subscribeToStreamStateEvents(debug = false) {
    const stateSub = this.eventBus.on(
      'streaming:*', // Wildcard for all streaming events
      (payload) => this.handleStreamStateChange(payload, debug),
      { priority: 50 }
    )
    this.subscriptions.set('stream_state', stateSub)
  }

  /**
   * Subscribe to multi-model events
   */
  subscribeToMultiModelEvents(debug = false) {
    // Multi-stream started
    const multiStartedSub = this.eventBus.on(
      STREAMING_EVENTS.MULTI_STREAM_STARTED,
      (payload) => this.handleMultiStreamStarted(payload, debug),
      { priority: 90 }
    )
    this.subscriptions.set('multi_started', multiStartedSub)

    // Leaderboard updated
    const leaderboardSub = this.eventBus.on(
      STREAMING_EVENTS.MULTI_LEADERBOARD_UPDATED,
      (payload) => this.handleLeaderboardUpdated(payload, debug),
      { priority: 80 }
    )
    this.subscriptions.set('leaderboard', leaderboardSub)
  }

  /**
   * Subscribe to performance events
   */
  subscribeToPerformanceEvents() {
    const perfSub = this.eventBus.on(
      STREAMING_EVENTS.PERFORMANCE_METRIC,
      (payload) => this.handlePerformanceMetric(payload),
      { priority: 60 }
    )
    this.subscriptions.set('performance', perfSub)

    const latencySub = this.eventBus.on(
      STREAMING_EVENTS.LATENCY_MEASURED,
      (payload) => this.handleLatencyMeasured(payload),
      { priority: 60 }
    )
    this.subscriptions.set('latency', latencySub)
  }

  /**
   * Event handlers
   */
  handleFirstChunk(payload, debug) {
    const { modelIndex, provider, model, latency } = payload.data
    
    if (debug) {
      console.log(`${color.green}📡 FIRST CHUNK:${color.reset} ${provider}/${model} (${latency}ms)`)
    }
    
    logger.debug(`StreamingObserver: First chunk from ${provider}/${model} at ${latency}ms`)
    
    // Track metrics
    this.metrics.set(`first_chunk_${modelIndex}`, {
      provider,
      model,
      latency,
      timestamp: payload.timestamp
    })
  }

  handleChunkReceived(payload, debug) {
    const { modelIndex, content, chunkSize } = payload.data
    
    if (debug && chunkSize > 50) { // Only log significant chunks
      logger.debug(`StreamingObserver: Chunk received (${chunkSize} chars) from model ${modelIndex}`)
    }
  }

  handleLastChunk(payload, debug) {
    const { modelIndex, provider, totalSize, duration } = payload.data
    
    if (debug) {
      console.log(`${color.blue}🏁 LAST CHUNK:${color.reset} ${provider} (${totalSize} chars, ${duration}ms)`)
    }
    
    logger.debug(`StreamingObserver: Last chunk from ${provider}: ${totalSize} chars in ${duration}ms`)
    
    // Track completion metrics
    this.metrics.set(`completion_${modelIndex}`, {
      provider,
      totalSize,
      duration,
      timestamp: payload.timestamp
    })
  }

  handleModelStarted(payload, debug) {
    const { modelIndex, provider, model } = payload.data
    
    if (debug) {
      console.log(`${color.cyan}🚀 MODEL STARTED:${color.reset} ${provider}/${model}`)
    }
    
    logger.debug(`StreamingObserver: Model started: ${provider}/${model}`)
  }

  handleModelCompleted(payload, debug) {
    const { modelIndex, provider, success, error } = payload.data
    
    if (debug) {
      const status = success ? '✓ completed' : '✗ failed'
      console.log(`${color.green}${status}:${color.reset} ${provider}`)
    }
    
    logger.debug(`StreamingObserver: Model completed: ${provider} (success: ${success})`)
  }

  handleModelError(payload, debug) {
    const { modelIndex, provider, error } = payload.data
    
    if (debug) {
      console.log(`${color.red}💥 MODEL ERROR:${color.reset} ${provider} - ${error}`)
    }
    
    logger.error(`StreamingObserver: Model error in ${provider}: ${error}`)
  }

  handleStreamStateChange(payload, debug) {
    if (debug && payload.type.includes('state')) {
      logger.debug(`StreamingObserver: State change: ${payload.type}`)
    }
  }

  handleMultiStreamStarted(payload, debug) {
    const { totalModels, models } = payload.data
    
    if (debug) {
      console.log(`${color.yellow}🔄 MULTI-STREAM:${color.reset} ${totalModels} models starting`)
    }
    
    logger.debug(`StreamingObserver: Multi-stream started with ${totalModels} models`)
  }

  handleLeaderboardUpdated(payload, debug) {
    const { leaderboard, newLeader } = payload.data
    
    if (debug && newLeader) {
      console.log(`${color.magenta}🏆 NEW LEADER:${color.reset} ${newLeader.provider}`)
    }
    
    logger.debug(`StreamingObserver: Leaderboard updated, leader: ${newLeader?.provider || 'none'}`)
  }

  handlePerformanceMetric(payload) {
    const { metric, value, unit } = payload.data
    this.metrics.set(`perf_${metric}`, { value, unit, timestamp: payload.timestamp })
    logger.debug(`StreamingObserver: Performance metric: ${metric} = ${value} ${unit}`)
  }

  handleLatencyMeasured(payload) {
    const { phase, latency, provider } = payload.data
    this.metrics.set(`latency_${provider}_${phase}`, { latency, timestamp: payload.timestamp })
    logger.debug(`StreamingObserver: Latency measured: ${provider} ${phase} = ${latency}ms`)
  }

  /**
   * Emit a streaming event



   */
  emit(eventType, data, options = {}) {
    if (!this.isActive && !eventType.includes('stream_started')) {
      return // Don't emit if not observing (except for start event)
    }

    this.eventBus.emitSync(eventType, data, {
      source: 'StreamingObserver',
      ...options
    })
  }

  /**
   * Get collected metrics

   */
  getMetrics() {
    return {
      observationStartTime: this.startTime,
      observationDuration: this.startTime ? Date.now() - this.startTime : 0,
      metricsCount: this.metrics.size,
      subscriptionsCount: this.subscriptions.size,
      isActive: this.isActive,
      metrics: Object.fromEntries(this.metrics)
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
export const streamingObserver = new StreamingObserver()

/**
 * Convenience function to start observing with common options


 */
export function startStreamingObserver(options = {}) {
  streamingObserver.startObserving(options)
  return streamingObserver
}

/**
 * Convenience function to stop observing

 */
export function stopStreamingObserver() {
  const metrics = streamingObserver.getMetrics()
  streamingObserver.stopObserving()
  return metrics
}