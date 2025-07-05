import { AppError } from './error-handler.js'
import { logger } from './logger.js'

/**
 * Advanced Event Emitter with async support and error handling
 */
export class EventEmitter {
  constructor(options = {}) {
    this.events = new Map()
    this.maxListeners = options.maxListeners || 100
    this.captureRejections = options.captureRejections || true
    this.asyncQueue = []
    this.processing = false
  }

  /**
   * Add event listener
   */
  on(eventName, listener) {
    this.validateListener(listener)
    
    if (!this.events.has(eventName)) {
      this.events.set(eventName, [])
    }
    
    const listeners = this.events.get(eventName)
    
    if (listeners.length >= this.maxListeners) {
      logger.warn(`Max listeners (${this.maxListeners}) exceeded for event: ${eventName}`)
    }
    
    listeners.push({
      listener,
      once: false,
      priority: 0
    })
    
    return this
  }

  /**
   * Add one-time event listener
   */
  once(eventName, listener) {
    this.validateListener(listener)
    
    if (!this.events.has(eventName)) {
      this.events.set(eventName, [])
    }
    
    this.events.get(eventName).push({
      listener,
      once: true,
      priority: 0
    })
    
    return this
  }

  /**
   * Add priority event listener
   */
  onPriority(eventName, listener, priority = 1) {
    this.validateListener(listener)
    
    if (!this.events.has(eventName)) {
      this.events.set(eventName, [])
    }
    
    const listeners = this.events.get(eventName)
    listeners.push({
      listener,
      once: false,
      priority
    })
    
    // Sort by priority (higher priority first)
    listeners.sort((a, b) => b.priority - a.priority)
    
    return this
  }

  /**
   * Remove event listener
   */
  off(eventName, listener) {
    if (!this.events.has(eventName)) {
      return this
    }
    
    const listeners = this.events.get(eventName)
    const index = listeners.findIndex(l => l.listener === listener)
    
    if (index !== -1) {
      listeners.splice(index, 1)
    }
    
    if (listeners.length === 0) {
      this.events.delete(eventName)
    }
    
    return this
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(eventName) {
    if (eventName) {
      this.events.delete(eventName)
    } else {
      this.events.clear()
    }
    
    return this
  }

  /**
   * Emit event synchronously
   */
  emit(eventName, ...args) {
    if (!this.events.has(eventName)) {
      return false
    }
    
    const listeners = this.events.get(eventName).slice()
    let hasListeners = false
    
    for (let i = 0; i < listeners.length; i++) {
      const { listener, once } = listeners[i]
      hasListeners = true
      
      try {
        listener(...args)
      } catch (error) {
        if (this.captureRejections) {
          this.emit('error', error)
        } else {
          throw error
        }
      }
      
      if (once) {
        this.off(eventName, listener)
      }
    }
    
    return hasListeners
  }

  /**
   * Emit event asynchronously
   */
  async emitAsync(eventName, ...args) {
    if (!this.events.has(eventName)) {
      return false
    }
    
    const listeners = this.events.get(eventName).slice()
    let hasListeners = false
    
    for (const { listener, once } of listeners) {
      hasListeners = true
      
      try {
        await listener(...args)
      } catch (error) {
        if (this.captureRejections) {
          this.emit('error', error)
        } else {
          throw error
        }
      }
      
      if (once) {
        this.off(eventName, listener)
      }
    }
    
    return hasListeners
  }

  /**
   * Emit event with parallel async execution
   */
  async emitParallel(eventName, ...args) {
    if (!this.events.has(eventName)) {
      return false
    }
    
    const listeners = this.events.get(eventName).slice()
    
    if (listeners.length === 0) {
      return false
    }
    
    const promises = listeners.map(async ({ listener, once }) => {
      try {
        await listener(...args)
        if (once) {
          this.off(eventName, listener)
        }
      } catch (error) {
        if (this.captureRejections) {
          this.emit('error', error)
        } else {
          throw error
        }
      }
    })
    
    await Promise.all(promises)
    return true
  }

  /**
   * Get listener count for an event
   */
  listenerCount(eventName) {
    const listeners = this.events.get(eventName)
    return listeners ? listeners.length : 0
  }

  /**
   * Get all event names
   */
  eventNames() {
    return Array.from(this.events.keys())
  }

  /**
   * Get listeners for an event
   */
  listeners(eventName) {
    const listeners = this.events.get(eventName)
    return listeners ? listeners.map(l => l.listener) : []
  }

  /**
   * Validate listener function
   */
  validateListener(listener) {
    if (typeof listener !== 'function') {
      throw new AppError('Listener must be a function', true, 400)
    }
  }

  /**
   * Create a promise that resolves when event is emitted
   */
  waitFor(eventName, timeout = 0) {
    return new Promise((resolve, reject) => {
      let timeoutId
      
      const cleanup = () => {
        this.off(eventName, listener)
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
      }
      
      const listener = (...args) => {
        cleanup()
        resolve(args)
      }
      
      this.once(eventName, listener)
      
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          cleanup()
          reject(new AppError(`Timeout waiting for event: ${eventName}`, true, 408))
        }, timeout)
      }
    })
  }

  /**
   * Pipe events from another emitter
   */
  pipe(sourceEmitter, eventMapping = {}) {
    const sourceEvents = sourceEmitter.eventNames()
    
    for (const eventName of sourceEvents) {
      const targetEventName = eventMapping[eventName] || eventName
      
      sourceEmitter.on(eventName, (...args) => {
        this.emit(targetEventName, ...args)
      })
    }
    
    return this
  }

  /**
   * Get statistics
   */
  getStats() {
    let totalListeners = 0
    const eventStats = {}
    
    for (const [eventName, listeners] of this.events) {
      eventStats[eventName] = listeners.length
      totalListeners += listeners.length
    }
    
    return {
      totalEvents: this.events.size,
      totalListeners,
      maxListeners: this.maxListeners,
      events: eventStats
    }
  }
}

// Global event emitter instance
export const globalEmitter = new EventEmitter()