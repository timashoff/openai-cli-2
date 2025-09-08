/**
 * Error Recovery System - Strategies for automatic error handling
 * Implements retry logic, exponential backoff, and recovery patterns
 */
import * as ErrorTypes from './ErrorTypes.js'

const { BaseError, NetworkError, APIError, CancellationError } = ErrorTypes
import { logger } from '../../utils/logger.js'

/**
 * Recovery strategy enumeration
 */
export const RecoveryStrategy = {
  /** Retry the operation with backoff */
  RETRY: 'retry',
  /** Try alternative approach */
  FALLBACK: 'fallback',
  /** Recover and continue with safe default */
  RECOVER: 'recover',
  /** Fail gracefully with user notification */
  FAIL_GRACEFUL: 'fail_graceful',
  /** Critical error - shutdown required */
  SHUTDOWN: 'shutdown'
}

/**
 * Retry configuration
 */
export const RetryConfig = {
  DEFAULT: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2
  },
  NETWORK: {
    maxAttempts: 5,
    baseDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 1.5
  },
  API: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 8000,
    backoffMultiplier: 2
  },
  CRITICAL: {
    maxAttempts: 1,
    baseDelay: 0,
    maxDelay: 0,
    backoffMultiplier: 1
  }
}

/**
 * Error recovery system with automatic retry and fallback strategies
 */
export class ErrorRecovery {
  constructor() {
    this.fallbackHandlers = new Map()
    this.recoveryHandlers = new Map()
    this.retryStats = new Map()
  }

  /**
   * Execute operation with automatic recovery
   */
  async executeWithRecovery(operation, context = {}, strategy = RecoveryStrategy.RETRY) {
    const operationId = this.generateOperationId(context)
    
    try {
      return await this.attemptOperation(operation, context, strategy)
    } catch (error) {
      logger.debug(`Operation ${operationId} failed, attempting recovery`, {
        error: error.message,
        strategy,
        context
      })
      
      return await this.recoverFromError(error, operation, context, strategy)
    }
  }

  /**
   * Attempt operation with retry logic
   */
  async attemptOperation(operation, context, strategy) {
    const config = this.getRetryConfig(context, strategy)
    let lastError = null
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        const result = await this.executeWithTimeout(operation, context)
        
        // Success - reset retry stats
        this.resetRetryStats(context)
        return result
        
      } catch (error) {
        lastError = error
        
        // Don't retry cancellation errors
        if (error instanceof CancellationError || this.isCancellationError(error)) {
          throw error
        }
        
        // Don't retry authentication errors
        if (this.isAuthenticationError(error)) {
          throw error
        }
        
        // Last attempt - don't wait
        if (attempt === config.maxAttempts) {
          break
        }
        
        // Check if we should retry this error
        if (!this.shouldRetryError(error)) {
          break
        }
        
        // Wait before retry with exponential backoff
        const delay = this.calculateBackoffDelay(attempt, config)
        logger.debug(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
          error: error.message,
          context: this.generateOperationId(context)
        })
        
        await this.sleep(delay)
        this.recordRetryAttempt(context, attempt, error)
      }
    }
    
    // All retries exhausted
    throw lastError
  }

  /**
   * Recover from error using appropriate strategy
   */
  async recoverFromError(error, operation, context, strategy) {
    const operationId = this.generateOperationId(context)
    
    switch (strategy) {
      case RecoveryStrategy.RETRY:
        // Already handled in attemptOperation
        throw error
        
      case RecoveryStrategy.FALLBACK:
        return await this.attemptFallback(error, operation, context)
        
      case RecoveryStrategy.RECOVER:
        return await this.attemptRecovery(error, context)
        
      case RecoveryStrategy.FAIL_GRACEFUL:
        return this.failGracefully(error, context)
        
      case RecoveryStrategy.SHUTDOWN:
        await this.initiateShutdown(error, context)
        throw error
        
      default:
        throw error
    }
  }

  /**
   * Attempt fallback recovery
   */
  async attemptFallback(error, originalOperation, context) {
    const pattern = this.getHandlerPattern(context)
    const handlers = this.fallbackHandlers.get(pattern) || this.fallbackHandlers.get('*') || []
    
    for (const handler of handlers) {
      try {
        logger.info(`Attempting fallback for ${pattern}`)
        const result = await handler(error, originalOperation, context)
        
        logger.info(`Fallback successful for ${pattern}`)
        return result
        
      } catch (fallbackError) {
        logger.warn(`Fallback handler failed: ${fallbackError.message}`)
        continue
      }
    }
    
    // No successful fallback
    return this.failGracefully(error, context)
  }

  /**
   * Attempt recovery with registered handlers
   */
  async attemptRecovery(error, context) {
    const pattern = this.getHandlerPattern(context)
    const handlers = this.recoveryHandlers.get(pattern) || this.recoveryHandlers.get('*') || []
    
    for (const handler of handlers) {
      try {
        logger.info(`Attempting recovery for ${pattern}`)
        const result = await handler(error, context)
        
        logger.info(`Recovery successful for ${pattern}`)
        return result
        
      } catch (recoveryError) {
        logger.warn(`Recovery handler failed: ${recoveryError.message}`)
        continue
      }
    }
    
    // No successful recovery
    return this.failGracefully(error, context)
  }

  /**
   * Fail gracefully with safe defaults
   */
  failGracefully(error, context) {
    const operationId = this.generateOperationId(context)
    logger.warn(`Failing gracefully for ${operationId}`)
    
    // Return safe defaults based on operation type
    const safeDefaults = {
      'chat_completion': { content: 'Error processing request. Please try again.' },
      'list_models': [],
      'provider_switch': false,
      'stream_processing': [],
      'cache_operation': null,
      'file_operation': null,
      'validation': false
    }
    
    const operation = context.operation || 'unknown'
    return safeDefaults[operation] || null
  }

  /**
   * Initiate graceful shutdown
   */
  async initiateShutdown(error, context) {
    logger.error('Critical error - initiating graceful shutdown', {
      error: error.message,
      context: this.generateOperationId(context)
    })
    
    // Give time for cleanup
    setTimeout(() => {
      process.exit(1)
    }, 3000)
  }

  /**
   * Register fallback handler
   */
  addFallbackHandler(pattern, handler) {
    if (!this.fallbackHandlers.has(pattern)) {
      this.fallbackHandlers.set(pattern, [])
    }
    this.fallbackHandlers.get(pattern).push(handler)
    
    logger.debug(`Registered fallback handler for pattern: ${pattern}`)
  }

  /**
   * Register recovery handler
   */
  addRecoveryHandler(pattern, handler) {
    if (!this.recoveryHandlers.has(pattern)) {
      this.recoveryHandlers.set(pattern, [])
    }
    this.recoveryHandlers.get(pattern).push(handler)
    
    logger.debug(`Registered recovery handler for pattern: ${pattern}`)
  }

  /**
   * Execute operation with timeout
   */
  async executeWithTimeout(operation, context) {
    const timeout = this.getOperationTimeout(context)
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new BaseError(`Operation timeout: ${context.operation || 'unknown'}`, true, 408))
      }, timeout)
    })
    
    return Promise.race([operation(), timeoutPromise])
  }

  /**
   * Get retry configuration for context
   */
  getRetryConfig(context, strategy) {
    if (strategy === RecoveryStrategy.SHUTDOWN) {
      return RetryConfig.CRITICAL
    }
    
    const operation = context.operation || 'unknown'
    
    if (operation.includes('network') || operation.includes('fetch')) {
      return RetryConfig.NETWORK
    }
    
    if (operation.includes('api') || operation.includes('provider')) {
      return RetryConfig.API
    }
    
    return RetryConfig.DEFAULT
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoffDelay(attempt, config) {
    const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1)
    return Math.min(delay, config.maxDelay)
  }

  /**
   * Get operation timeout
   */
  getOperationTimeout(context) {
    const timeouts = {
      'chat_completion': 60000,
      'list_models': 15000,
      'provider_switch': 10000,
      'stream_processing': 5000,
      'file_operation': 30000,
      'cache_operation': 5000
    }
    
    return timeouts[context.operation] || 30000
  }

  /**
   * Check if error should be retried
   */
  shouldRetryError(error) {
    // Never retry cancellation
    if (error instanceof CancellationError || this.isCancellationError(error)) {
      return false
    }
    
    // Never retry authentication errors
    if (this.isAuthenticationError(error)) {
      return false
    }
    
    // Retry network errors
    if (error instanceof NetworkError) {
      return true
    }
    
    // Retry some API errors (5xx, timeouts)
    if (error instanceof APIError) {
      return error.statusCode >= 500 || error.statusCode === 429
    }
    
    // Retry based on error message patterns
    if (error.message) {
      const retryablePatterns = [
        'timeout',
        'connection',
        'network',
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT',
        'rate limit',
        'too many requests'
      ]
      
      return retryablePatterns.some(pattern => 
        error.message.toLowerCase().includes(pattern.toLowerCase())
      )
    }
    
    return false
  }

  /**
   * Utility methods
   */
  generateOperationId(context) {
    return `${context.operation || 'unknown'}:${context.component || 'unknown'}`
  }

  getHandlerPattern(context) {
    return this.generateOperationId(context)
  }

  isCancellationError(error) {
    return error.name === 'AbortError' ||
           (error.message && error.message.toLowerCase().includes('abort'))
  }

  isAuthenticationError(error) {
    return error.statusCode === 401 ||
           error.statusCode === 403 ||
           (error.message && (
             error.message.includes('authentication') ||
             error.message.includes('unauthorized') ||
             error.message.includes('forbidden')
           ))
  }

  recordRetryAttempt(context, attempt, error) {
    const operationId = this.generateOperationId(context)
    if (!this.retryStats.has(operationId)) {
      this.retryStats.set(operationId, [])
    }
    
    this.retryStats.get(operationId).push({
      attempt,
      error: error.message,
      timestamp: new Date()
    })
  }

  resetRetryStats(context) {
    const operationId = this.generateOperationId(context)
    this.retryStats.delete(operationId)
  }

  getRetryStats() {
    return Object.fromEntries(this.retryStats)
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Global instance
export const errorRecovery = new ErrorRecovery()