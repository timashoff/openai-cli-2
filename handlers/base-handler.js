import { AppError } from '../utils/error-handler.js'

/**
 * Request processing context
 */

/**
 * Handler processing result
 */

/**
 * Base request handler for Chain of Responsibility pattern
 * Provides common functionality for all request processing handlers
 */
export class BaseRequestHandler {
  /**




   */
  constructor(dependencies = {}) {
    this.eventBus = dependencies.eventBus
    this.logger = dependencies.logger
    this.errorBoundary = dependencies.errorBoundary
    
    /** @type {BaseRequestHandler|null} */
    this.nextHandler = null
    /** @type {string} */
    this.handlerName = this.constructor.name
    /** @type {Map<string, number>} */
    this.processingStats = new Map()
    /** @type {Date} */
    this.lastProcessed = null
  }

  /**
   * Set next handler in the chain


   */
  setNext(handler) {
    if (!(handler instanceof BaseRequestHandler)) {
      throw new AppError('Handler must extend BaseRequestHandler', true, 400)
    }
    
    this.nextHandler = handler
    this.log('debug', `Next handler set: ${handler.handlerName}`)
    return handler
  }

  /**
   * Handle request with error boundary protection


   */
  async handle(context) {
    this.validateContext(context)
    
    const startTime = Date.now()
    this.lastProcessed = new Date()
    
    try {
      // Use error boundary for resilient processing
      const result = this.errorBoundary ? 
        await this.errorBoundary.execute(
          () => this.processWithChain(context),
          {
            operation: 'request_handling',
            component: this.handlerName,
            metadata: { input: context.originalInput.substring(0, 100) }
          }
        ) :
        await this.processWithChain(context)
      
      // Update statistics
      this.updateStats('processed', Date.now() - startTime)
      
      // Emit processing event
      this.emitEvent('handler:processed', {
        handler: this.handlerName,
        handled: result.handled,
        duration: Date.now() - startTime
      })
      
      return result
      
    } catch (error) {
      this.updateStats('error', Date.now() - startTime, error.message)
      this.log('error', `Handler processing failed: ${error.message}`)
      
      // Emit error event
      this.emitEvent('handler:error', {
        handler: this.handlerName,
        error: error.message,
        duration: Date.now() - startTime
      })
      
      // Continue chain on error unless critical
      if (this.isCriticalError(error)) {
        throw error
      }
      
      return this.createErrorResult(error)
    }
  }

  /**
   * Process request and continue chain if needed


   */
  async processWithChain(context) {
    // Check if this handler can process the request
    if (await this.canHandle(context)) {
      this.log('info', `Processing request with ${this.handlerName}`)
      
      // Process the request
      const result = await this.process(context)
      
      // If handled and should stop chain, return immediately
      if (result.handled && result.stopChain) {
        this.log('debug', `Chain stopped by ${this.handlerName}`)
        return result
      }
      
      // If handled but not stopping chain, update context for next handlers
      if (result.handled && result.nextInput) {
        context.processedInput = result.nextInput
        context.metadata = { ...context.metadata, ...result.metadata }
      }
      
      // Return if fully handled
      if (result.handled && result.result !== undefined) {
        return result
      }
    }
    
    // Continue to next handler if available
    if (this.nextHandler) {
      this.log('debug', `Passing to next handler: ${this.nextHandler.handlerName}`)
      return await this.nextHandler.handle(context)
    }
    
    // End of chain - no handler could process
    this.log('debug', 'End of handler chain reached')
    return this.createUnhandledResult(context)
  }

  /**
   * Check if this handler can process the request
   * Override in subclasses


   */
  async canHandle(context) {
    return false
  }

  /**
   * Process the request - must be implemented by subclasses


   */
  async process(context) {
    throw new Error(`${this.handlerName} must implement process() method`)
  }

  /**
   * Create successful result



   */
  createResult(result, options = {}) {
    return {
      handled: true,
      result,
      stopChain: options.stopChain || false,
      nextInput: options.nextInput || null,
      metadata: {
        handler: this.handlerName,
        timestamp: new Date(),
        ...options.metadata
      }
    }
  }

  /**
   * Create pass-through result (for middleware handlers)



   */
  createPassThrough(nextInput, metadata = {}) {
    return {
      handled: true,
      result: undefined, // No final result
      stopChain: false,
      nextInput,
      metadata: {
        handler: this.handlerName,
        passThrough: true,
        timestamp: new Date(),
        ...metadata
      }
    }
  }

  /**
   * Create unhandled result


   */
  createUnhandledResult(context) {
    return {
      handled: false,
      result: null,
      stopChain: true,
      nextInput: null,
      metadata: {
        reason: 'no_handler_found',
        originalInput: context.originalInput,
        timestamp: new Date()
      }
    }
  }

  /**
   * Create error result


   */
  createErrorResult(error) {
    return {
      handled: false,
      result: null,
      stopChain: false, // Continue chain unless critical
      nextInput: null,
      metadata: {
        error: error.message,
        handler: this.handlerName,
        timestamp: new Date()
      }
    }
  }

  /**
   * Validate processing context

   */
  validateContext(context) {
    if (!context) {
      throw new AppError('Processing context is required', true, 400)
    }
    
    const required = ['originalInput', 'processedInput', 'services']
    const missing = required.filter(field => context[field] === undefined)
    
    if (missing.length > 0) {
      throw new AppError(`Missing required context fields: ${missing.join(', ')}`, true, 400)
    }
  }

  /**
   * Check if error is critical (should stop chain)


   */
  isCriticalError(error) {
    return error.name === 'AbortError' || 
           error.message.includes('aborted') ||
           error.message.includes('cancelled')
  }

  /**
   * Update handler statistics



   */
  updateStats(action, duration, error = null) {
    const key = error ? `${action}:error` : action
    const current = this.processingStats.get(key) || { count: 0, totalDuration: 0, errors: [] }
    
    current.count++
    current.totalDuration += duration
    current.averageDuration = current.totalDuration / current.count
    current.lastProcessed = new Date()
    
    if (error && current.errors.length < 5) {
      current.errors.push({ error, timestamp: new Date() })
    }
    
    this.processingStats.set(key, current)
  }

  /**
   * Get handler statistics

   */
  getStats() {
    const stats = {
      handlerName: this.handlerName,
      lastProcessed: this.lastProcessed,
      hasNextHandler: !!this.nextHandler,
      nextHandlerName: this.nextHandler ? this.nextHandler.handlerName : null
    }
    
    // Convert map to object
    for (const [key, data] of this.processingStats) {
      stats[key] = { ...data }
    }
    
    return stats
  }

  /**
   * Get handler health status

   */
  getHealthStatus() {
    const processedStats = this.processingStats.get('processed')
    const errorStats = this.processingStats.get('processed:error')
    
    const totalProcessed = processedStats ? processedStats.count : 0
    const totalErrors = errorStats ? errorStats.count : 0
    const errorRate = totalProcessed > 0 ? (totalErrors / totalProcessed) * 100 : 0
    
    return {
      handlerName: this.handlerName,
      isHealthy: errorRate < 10, // Healthy if error rate < 10%
      totalProcessed,
      totalErrors,
      errorRate,
      lastProcessed: this.lastProcessed,
      averageProcessingTime: processedStats ? processedStats.averageDuration : 0
    }
  }

  /**
   * Emit event through event bus


   */
  emitEvent(eventName, data = {}) {
    if (this.eventBus) {
      this.eventBus.emitSync(`request-handler:${eventName}`, {
        ...data,
        handler: this.handlerName,
        timestamp: new Date()
      })
    }
  }

  /**
   * Log message with handler context



   */
  log(level, message, context = {}) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, {
        handler: this.handlerName,
        ...context
      })
    }
  }

  /**
   * Dispose handler and cleanup resources
   */
  dispose() {
    this.nextHandler = null
    this.processingStats.clear()
    this.lastProcessed = null
  }
}