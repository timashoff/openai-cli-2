import { AppError } from './error-handler.js'
import { sanitizeErrorMessage } from './security.js'

/**
 * Error recovery strategy enumeration
 */
export const ErrorRecoveryStrategy = {
  /** Try to recover and continue */
  RECOVER: 'recover',
  /** Retry the operation */
  RETRY: 'retry',
  /** Fallback to alternative */
  FALLBACK: 'fallback',
  /** Fail gracefully */
  FAIL_GRACEFUL: 'fail_graceful',
  /** Critical error - shutdown */
  SHUTDOWN: 'shutdown'
}

/**
 * Error context information
 */

/**
 * Error boundary for graceful error handling and recovery
 * Implements Circuit Breaker pattern with automatic fallbacks
 */
export class ErrorBoundary {
  /**




   */
  constructor(dependencies = {}) {
    this.eventBus = dependencies.eventBus
    this.logger = dependencies.logger
    this.config = dependencies.config

    /** @type {Map<string, CircuitBreakerState>} */
    this.circuitBreakers = new Map()
    /** @type {Map<string, number>} */
    this.errorCounts = new Map()
    /** @type {Map<string, Date>} */
    this.lastErrors = new Map()
    /** @type {Map<string, Function[]>} */
    this.fallbackHandlers = new Map()
    /** @type {Map<string, Function[]>} */
    this.recoveryHandlers = new Map()
    
    this.setupGlobalHandlers()
  }

  /**
   * Execute operation with error boundary protection




   * const result = await errorBoundary.execute(
   *   () => provider.createChatCompletion(model, messages),
   *   { operation: 'chat_completion', component: 'ProviderService' },
   *   ErrorRecoveryStrategy.FALLBACK
   * )
   */
  async execute(operation, context, strategy = ErrorRecoveryStrategy.FAIL_GRACEFUL) {
    this.validateOperation(operation, context)
    
    const contextId = this.generateContextId(context)
    const circuitBreaker = this.getCircuitBreaker(contextId)
    
    // Check circuit breaker state
    if (circuitBreaker.state === 'OPEN') {
      if (!this.shouldRetryCircuitBreaker(circuitBreaker)) {
        return this.handleCircuitBreakerOpen(contextId, context, strategy)
      } else {
        circuitBreaker.state = 'HALF_OPEN'
        this.log('info', `Circuit breaker ${contextId} moved to HALF_OPEN`)
      }
    }

    const maxRetries = this.getMaxRetries(strategy)
    let lastError = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(operation, context)
        
        // Success - reset circuit breaker
        this.resetCircuitBreaker(contextId)
        this.emitSuccessEvent(context, attempt)
        
        return result

      } catch (error) {
        lastError = error
        
        // Record error
        this.recordError(contextId, error, context)
        
        // Check if we should continue retrying
        if (attempt < maxRetries && this.shouldRetry(error, context, attempt)) {
          await this.waitBeforeRetry(attempt)
          continue
        }
        
        // All retries exhausted - handle according to strategy
        break
      }
    }

    // Handle final error according to strategy
    return this.handleError(lastError, context, strategy, contextId)
  }

  /**
   * Add fallback handler for specific operation/component


   * errorBoundary.addFallbackHandler('chat_completion:ProviderService', async (error, context) => {
   *   // Try alternative provider
   *   return await alternativeProvider.createChatCompletion(model, messages)
   * })
   */
  addFallbackHandler(pattern, handler) {
    if (typeof handler !== 'function') {
      throw new AppError('Fallback handler must be a function', true, 400)
    }

    if (!this.fallbackHandlers.has(pattern)) {
      this.fallbackHandlers.set(pattern, [])
    }
    
    this.fallbackHandlers.get(pattern).push(handler)
    this.log('debug', `Added fallback handler for pattern: ${pattern}`)
  }

  /**
   * Add recovery handler for specific operation/component


   */
  addRecoveryHandler(pattern, handler) {
    if (typeof handler !== 'function') {
      throw new AppError('Recovery handler must be a function', true, 400)
    }

    if (!this.recoveryHandlers.has(pattern)) {
      this.recoveryHandlers.set(pattern, [])
    }
    
    this.recoveryHandlers.get(pattern).push(handler)
    this.log('debug', `Added recovery handler for pattern: ${pattern}`)
  }

  /**
   * Get error statistics for monitoring

   */
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      errorsByType: {},
      errorsByComponent: {},
      circuitBreakers: {},
      recentErrors: []
    }

    for (const [contextId, count] of this.errorCounts) {
      stats.totalErrors += count
      
      const [operation, component] = contextId.split(':')
      stats.errorsByComponent[component] = (stats.errorsByComponent[component] || 0) + count
    }

    for (const [contextId, breaker] of this.circuitBreakers) {
      stats.circuitBreakers[contextId] = {
        state: breaker.state,
        failures: breaker.failures,
        lastFailure: breaker.lastFailure,
        nextRetryAt: breaker.nextRetryAt
      }
    }

    // Get recent errors (last 10)
    const recentEntries = Array.from(this.lastErrors.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .slice(0, 10)
    
    stats.recentErrors = recentEntries.map(([contextId, timestamp]) => ({
      contextId,
      timestamp
    }))

    return stats
  }

  /**
   * Reset circuit breaker for specific context

   */
  resetCircuitBreaker(contextId) {
    const breaker = this.circuitBreakers.get(contextId)
    if (breaker) {
      breaker.state = 'CLOSED'
      breaker.failures = 0
      breaker.lastFailure = null
      breaker.nextRetryAt = null
      
      this.log('debug', `Circuit breaker ${contextId} reset to CLOSED`)
    }
    
    this.errorCounts.delete(contextId)
    this.lastErrors.delete(contextId)
  }

  /**
   * Execute operation with timeout



   */
  async executeWithTimeout(operation, context) {
    const timeout = this.getOperationTimeout(context)
    
    return Promise.race([
      operation(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new AppError(`Operation timeout: ${context.operation}`, true, 408))
        }, timeout)
      })
    ])
  }

  /**
   * Handle error according to recovery strategy





   */
  async handleError(error, context, strategy, contextId) {
    this.log('error', `Handling error in ${context.operation}:${context.component}`, {
      error: error.message,
      strategy
    })

    // Update circuit breaker
    this.updateCircuitBreaker(contextId, error)

    // Emit error event
    this.emitErrorEvent(error, context, strategy)

    switch (strategy) {
      case ErrorRecoveryStrategy.RECOVER:
        return this.attemptRecovery(error, context)
        
      case ErrorRecoveryStrategy.FALLBACK:
        return this.attemptFallback(error, context)
        
      case ErrorRecoveryStrategy.FAIL_GRACEFUL:
        return this.failGracefully(error, context)
        
      case ErrorRecoveryStrategy.SHUTDOWN:
        return this.initiateShutdown(error, context)
        
      default:
        throw this.enhanceError(error, context)
    }
  }

  /**
   * Attempt to recover from error



   */
  async attemptRecovery(error, context) {
    const pattern = `${context.operation}:${context.component}`
    const handlers = this.recoveryHandlers.get(pattern) || this.recoveryHandlers.get('*') || []
    
    for (const handler of handlers) {
      try {
        this.log('info', `Attempting recovery with handler for ${pattern}`)
        const result = await handler(error, context)
        
        this.log('info', `Recovery successful for ${pattern}`)
        this.emitRecoveryEvent(context, 'success')
        return result
        
      } catch (recoveryError) {
        this.log('warn', `Recovery handler failed: ${recoveryError.message}`)
        continue
      }
    }
    
    this.emitRecoveryEvent(context, 'failed')
    return this.failGracefully(error, context)
  }

  /**
   * Attempt fallback strategy



   */
  async attemptFallback(error, context) {
    const pattern = `${context.operation}:${context.component}`
    const handlers = this.fallbackHandlers.get(pattern) || this.fallbackHandlers.get('*') || []
    
    for (const handler of handlers) {
      try {
        this.log('info', `Attempting fallback with handler for ${pattern}`)
        const result = await handler(error, context)
        
        this.log('info', `Fallback successful for ${pattern}`)
        this.emitFallbackEvent(context, 'success')
        return result
        
      } catch (fallbackError) {
        this.log('warn', `Fallback handler failed: ${fallbackError.message}`)
        continue
      }
    }
    
    this.emitFallbackEvent(context, 'failed')
    return this.failGracefully(error, context)
  }

  /**
   * Fail gracefully by returning safe default



   */
  failGracefully(error, context) {
    this.log('warn', `Failing gracefully for ${context.operation}:${context.component}`)
    
    // Return safe defaults based on operation type
    const safeDefaults = {
      'chat_completion': [],
      'list_models': [],
      'provider_switch': null,
      'stream_processing': [],
      'cache_operation': null
    }
    
    return safeDefaults[context.operation] || null
  }

  /**
   * Initiate graceful shutdown


   */
  async initiateShutdown(error, context) {
    this.log('error', `Critical error - initiating shutdown`, {
      error: error.message,
      context
    })
    
    this.emitCriticalErrorEvent(error, context)
    
    // Give time for cleanup
    setTimeout(() => {
      process.exit(1)
    }, 5000)
    
    throw this.enhanceError(error, context)
  }

  /**
   * Get or create circuit breaker for context


   */
  getCircuitBreaker(contextId) {
    if (!this.circuitBreakers.has(contextId)) {
      this.circuitBreakers.set(contextId, {
        state: 'CLOSED',
        failures: 0,
        lastFailure: null,
        nextRetryAt: null
      })
    }
    
    return this.circuitBreakers.get(contextId)
  }

  /**
   * Update circuit breaker on failure


   */
  updateCircuitBreaker(contextId, error) {
    const breaker = this.getCircuitBreaker(contextId)
    breaker.failures++
    breaker.lastFailure = new Date()
    
    const threshold = this.getCircuitBreakerThreshold(contextId)
    
    if (breaker.failures >= threshold && breaker.state === 'CLOSED') {
      breaker.state = 'OPEN'
      breaker.nextRetryAt = new Date(Date.now() + this.getCircuitBreakerTimeout(contextId))
      
      this.log('warn', `Circuit breaker ${contextId} opened after ${breaker.failures} failures`)
      this.emitCircuitBreakerEvent(contextId, 'opened')
    }
  }

  /**
   * Setup global error handlers
   */
  setupGlobalHandlers() {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.handleUnhandledError(error, 'unhandledRejection')
    })

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.handleUnhandledError(error, 'uncaughtException')
    })
  }

  /**
   * Handle unhandled errors


   */
  handleUnhandledError(error, type) {
    const sanitizedMessage = sanitizeErrorMessage(error.message)
    
    this.log('error', `${type}: ${sanitizedMessage}`, {
      stack: error.stack,
      type
    })
    
    this.emitUnhandledErrorEvent(error, type)
    
    // For critical errors, initiate graceful shutdown
    if (type === 'uncaughtException') {
      setTimeout(() => process.exit(1), 1000)
    }
  }

  /**
   * Generate context ID


   */
  generateContextId(context) {
    return `${context.operation}:${context.component}`
  }

  /**
   * Record error occurrence



   */
  recordError(contextId, error, context) {
    const count = this.errorCounts.get(contextId) || 0
    this.errorCounts.set(contextId, count + 1)
    this.lastErrors.set(contextId, new Date())
    
    this.log('debug', `Recorded error for ${contextId} (count: ${count + 1})`)
  }

  /**
   * Enhance error with context information



   */
  enhanceError(error, context) {
    const message = `${error.message} [${context.operation}:${context.component}]`
    const enhancedError = new AppError(message, true, 500)
    enhancedError.originalError = error
    enhancedError.context = context
    return enhancedError
  }

  /**
   * Emit success event
   */
  emitSuccessEvent(context, attempts) {
    this.eventBus?.emitSync('error-boundary:success', {
      context,
      attempts,
      timestamp: new Date()
    })
  }

  /**
   * Emit error event
   */
  emitErrorEvent(error, context, strategy) {
    this.eventBus?.emitSync('error-boundary:error', {
      error: error.message,
      context,
      strategy,
      timestamp: new Date()
    })
  }

  /**
   * Emit recovery event
   */
  emitRecoveryEvent(context, status) {
    this.eventBus?.emitSync('error-boundary:recovery', {
      context,
      status,
      timestamp: new Date()
    })
  }

  /**
   * Emit fallback event
   */
  emitFallbackEvent(context, status) {
    this.eventBus?.emitSync('error-boundary:fallback', {
      context,
      status,
      timestamp: new Date()
    })
  }

  /**
   * Emit circuit breaker event
   */
  emitCircuitBreakerEvent(contextId, action) {
    this.eventBus?.emitSync('error-boundary:circuit-breaker', {
      contextId,
      action,
      timestamp: new Date()
    })
  }

  /**
   * Emit critical error event
   */
  emitCriticalErrorEvent(error, context) {
    this.eventBus?.emitSync('error-boundary:critical', {
      error: error.message,
      context,
      timestamp: new Date()
    })
  }

  /**
   * Emit unhandled error event
   */
  emitUnhandledErrorEvent(error, type) {
    this.eventBus?.emitSync('error-boundary:unhandled', {
      error: error.message,
      type,
      timestamp: new Date()
    })
  }

  /**
   * Utility methods with reasonable defaults
   */
  
  validateOperation(operation, context) {
    if (typeof operation !== 'function') {
      throw new AppError('Operation must be a function', true, 400)
    }
    if (!context || !context.operation || !context.component) {
      throw new AppError('Context must include operation and component', true, 400)
    }
  }

  shouldRetryCircuitBreaker(breaker) {
    return breaker.nextRetryAt && new Date() >= breaker.nextRetryAt
  }

  handleCircuitBreakerOpen(contextId, context, strategy) {
    this.log('warn', `Circuit breaker ${contextId} is open`)
    return this.attemptFallback(new AppError('Circuit breaker is open', true, 503), context)
  }

  getMaxRetries(strategy) {
    const retries = {
      [ErrorRecoveryStrategy.RETRY]: 3,
      [ErrorRecoveryStrategy.RECOVER]: 2,
      [ErrorRecoveryStrategy.FALLBACK]: 1,
      [ErrorRecoveryStrategy.FAIL_GRACEFUL]: 0,
      [ErrorRecoveryStrategy.SHUTDOWN]: 0
    }
    return retries[strategy] || 0
  }

  shouldRetry(error, context, attempt) {
    // Don't retry on user abort
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      return false
    }
    
    // Don't retry on auth errors
    if (error.message.includes('401') || error.message.includes('403')) {
      return false
    }
    
    return true
  }

  async waitBeforeRetry(attempt) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 5000) // Exponential backoff, max 5s
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  getOperationTimeout(context) {
    const timeouts = {
      'chat_completion': 30000,
      'list_models': 10000,
      'provider_switch': 15000,
      'stream_processing': 5000
    }
    return timeouts[context.operation] || 10000
  }

  getCircuitBreakerThreshold(contextId) {
    return 5 // Open after 5 failures
  }

  getCircuitBreakerTimeout(contextId) {
    return 60000 // 1 minute
  }

  log(level, message, context = {}) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, { component: 'ErrorBoundary', ...context })
    }
  }
}

/**
 * Create global error boundary instance


 */
export function createErrorBoundary(dependencies) {
  return new ErrorBoundary(dependencies)
}