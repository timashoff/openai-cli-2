import { AppError } from './error-handler.js'
import { logger } from './logger.js'

/**
 * Event subscription descriptor
 */

/**
 * Event payload
 */

/**
 * Modern Event Bus implementation with advanced features:
 * - Typed events with payload validation
 * - Priority-based event handling
 * - Async event processing
 * - Event middleware support
 * - Memory leak protection
 * - Performance monitoring
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, EventSubscription[]>} */
    this.subscriptions = new Map()
    /** @type {Function[]} */
    this.middleware = []
    /** @type {Set<string>} */
    this.activeEvents = new Set()
    /** @type {Map<string, number>} */
    this.eventStats = new Map()
    /** @type {number} */
    this.subscriptionCounter = 0
    /** @type {boolean} */
    this.isDisposed = false
    /** @type {number} */
    this.maxListeners = 100
  }

  /**
   * Subscribe to an event with options







   * const id = eventBus.on('user:login', (payload) => {
   *   console.log('User logged in:', payload.data.username)
   * }, { priority: 10 })
   */
  on(eventName, handler, options = {}) {
    this.validateSubscription(eventName, handler)
    
    if (!this.subscriptions.has(eventName)) {
      this.subscriptions.set(eventName, [])
    }

    const subscribers = this.subscriptions.get(eventName)
    
    // Check max listeners limit
    if (subscribers.length >= this.maxListeners) {
      throw new AppError(
        `Maximum listeners (${this.maxListeners}) exceeded for event '${eventName}'`,
        true,
        429
      )
    }

    const subscription = {
      id: `sub_${++this.subscriptionCounter}_${eventName}`,
      eventName,
      handler,
      options: {
        once: options.once || false,
        priority: options.priority || 0,
        context: options.context || null
      }
    }

    subscribers.push(subscription)
    
    // Sort by priority (higher priority first)
    subscribers.sort((a, b) => b.options.priority - a.options.priority)

    return subscription.id
  }

  /**
   * Subscribe to an event that executes only once




   */
  once(eventName, handler, options = {}) {
    return this.on(eventName, handler, { ...options, once: true })
  }

  /**
   * Unsubscribe from an event using subscription ID


   */
  off(subscriptionId) {
    for (const [eventName, subscribers] of this.subscriptions) {
      const index = subscribers.findIndex(sub => sub.id === subscriptionId)
      if (index !== -1) {
        subscribers.splice(index, 1)
        
        // Clean up empty event arrays
        if (subscribers.length === 0) {
          this.subscriptions.delete(eventName)
        }
        
        return true
      }
    }
    return false
  }

  /**
   * Remove all subscribers for a specific event


   */
  removeAllListeners(eventName) {
    const subscribers = this.subscriptions.get(eventName)
    if (!subscribers) return 0
    
    const count = subscribers.length
    this.subscriptions.delete(eventName)
    return count
  }

  /**
   * Emit an event to all subscribers






   */
  async emit(eventName, data = null, options = {}) {
    if (this.isDisposed) {
      throw new AppError('Cannot emit events on disposed EventBus', true, 500)
    }

    this.validateEventName(eventName)

    // Create event payload
    const payload = {
      type: eventName,
      data,
      timestamp: new Date(),
      source: options.source || 'unknown',
      metadata: options.metadata || {}
    }

    // Process middleware
    const processedPayload = await this.processMiddleware(payload)
    
    // Track active events for circular dependency detection
    if (this.activeEvents.has(eventName)) {
      logger.debug(`Circular event detected: ${eventName}`)
    }
    
    this.activeEvents.add(eventName)
    
    try {
      await this.executeHandlers(eventName, processedPayload)
      this.updateEventStats(eventName)
      return processedPayload
    } finally {
      this.activeEvents.delete(eventName)
    }
  }

  /**
   * Emit event synchronously (fire and forget)



   */
  emitSync(eventName, data = null, options = {}) {
    this.emit(eventName, data, options).catch(error => {
      console.error(`Error in async event '${eventName}':`, error.message)
    })
  }

  /**
   * Add middleware function that processes events before handlers

   * eventBus.use((payload) => {
   *   console.log('Event:', payload.type, 'at', payload.timestamp)
   *   return payload
   * })
   */
  use(middlewareFunc) {
    if (typeof middlewareFunc !== 'function') {
      throw new AppError('Middleware must be a function', true, 400)
    }
    this.middleware.push(middlewareFunc)
  }

  /**
   * Get list of subscribers for an event


   */
  getSubscribers(eventName) {
    return this.subscriptions.get(eventName) || []
  }

  /**
   * Get all event names that have subscribers

   */
  getEventNames() {
    return Array.from(this.subscriptions.keys())
  }

  /**
   * Get event statistics

   */
  getStats() {
    const stats = {
      totalEvents: this.subscriptions.size,
      totalSubscriptions: 0,
      activeEvents: this.activeEvents.size,
      middleware: this.middleware.length,
      eventCounts: Object.fromEntries(this.eventStats),
      isDisposed: this.isDisposed
    }

    for (const subscribers of this.subscriptions.values()) {
      stats.totalSubscriptions += subscribers.length
    }

    return stats
  }

  /**
   * Set maximum number of listeners per event

   */
  setMaxListeners(max) {
    if (typeof max !== 'number' || max < 0) {
      throw new AppError('Max listeners must be a non-negative number', true, 400)
    }
    this.maxListeners = max
  }

  /**
   * Dispose the event bus and cleanup resources
   */
  dispose() {
    if (this.isDisposed) return

    this.subscriptions.clear()
    this.middleware.length = 0
    this.activeEvents.clear()
    this.eventStats.clear()
    this.isDisposed = true
  }

  /**
   * Execute all handlers for an event


   */
  async executeHandlers(eventName, payload) {
    const subscribers = this.subscriptions.get(eventName)
    if (!subscribers || subscribers.length === 0) return

    const handlersToRemove = []
    const handlerPromises = []

    for (const subscription of subscribers) {
      try {
        const handlerPromise = this.executeHandler(subscription, payload)
        handlerPromises.push(handlerPromise)

        // Mark for removal if it's a once handler
        if (subscription.options.once) {
          handlersToRemove.push(subscription.id)
        }
      } catch (error) {
        console.error(`Error executing handler for event '${eventName}':`, error.message)
      }
    }

    // Wait for all handlers to complete
    await Promise.all(handlerPromises)

    // Remove once handlers
    for (const id of handlersToRemove) {
      this.off(id)
    }
  }

  /**
   * Execute individual event handler



   */
  async executeHandler(subscription, payload) {
    const { handler, options } = subscription
    
    try {
      if (options.context) {
        return await handler.call(options.context, payload)
      } else {
        return await handler(payload)
      }
    } catch (error) {
      console.error(`Handler error for event '${subscription.eventName}':`, error.message)
      throw error
    }
  }

  /**
   * Process event through middleware chain


   */
  async processMiddleware(payload) {
    let processedPayload = payload

    for (const middleware of this.middleware) {
      try {
        const result = await middleware(processedPayload)
        if (result) {
          processedPayload = result
        }
      } catch (error) {
        console.error('Middleware error:', error.message)
      }
    }

    return processedPayload
  }

  /**
   * Update event statistics

   */
  updateEventStats(eventName) {
    const current = this.eventStats.get(eventName) || 0
    this.eventStats.set(eventName, current + 1)
  }

  /**
   * Validate subscription parameters
   */
  validateSubscription(eventName, handler) {
    this.validateEventName(eventName)
    
    if (typeof handler !== 'function') {
      throw new AppError('Event handler must be a function', true, 400)
    }
  }

  /**
   * Validate event name

   */
  validateEventName(eventName) {
    if (!eventName || typeof eventName !== 'string' || eventName.trim() === '') {
      throw new AppError('Event name must be a non-empty string', true, 400)
    }
  }
}

/**
 * Create a new EventBus instance

 */
export function createEventBus() {
  return new EventBus()
}

// Global event bus instance for application-wide events
export const globalEventBus = createEventBus()