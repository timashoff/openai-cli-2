/**
 * Error Recovery System - Functional strategies for automatic error handling
 * Implements retry logic, exponential backoff, and recovery patterns
 */
import { 
  createBaseError,
  createNetworkError,
  createAPIError,
  createCancellationError,
  isCancellationError,
  isNetworkError,
  isAPIError
} from './ErrorTypes.js'
import { logger } from '../../utils/logger.js'

/**
 * Recovery strategy enumeration
 */
export const RecoveryStrategy = {
  RETRY: 'retry',
  FALLBACK: 'fallback',
  RECOVER: 'recover',
  FAIL_GRACEFUL: 'fail_graceful',
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
 * Utility functions for error recovery
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const generateOperationId = (context) => {
  return `${context.operation || 'unknown'}:${context.component || 'unknown'}`
}

const getHandlerPattern = (context) => {
  return generateOperationId(context)
}

const isAuthenticationError = (error) => {
  return error.statusCode === 401 ||
         error.statusCode === 403 ||
         (error.message && (
           error.message.includes('authentication') ||
           error.message.includes('unauthorized') ||
           error.message.includes('forbidden')
         ))
}

/**
 * Get retry configuration for context
 */
const getRetryConfig = (context, strategy) => {
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
const calculateBackoffDelay = (attempt, config) => {
  const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1)
  return Math.min(delay, config.maxDelay)
}

/**
 * Get operation timeout
 */
const getOperationTimeout = (context) => {
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
const shouldRetryError = (error) => {
  // Never retry cancellation
  if (error.type === 'CANCELLATION' || isCancellationError(error)) {
    return false
  }
  
  // Never retry authentication errors
  if (isAuthenticationError(error)) {
    return false
  }
  
  // Retry network errors
  if (error.type === 'NETWORK' || isNetworkError(error)) {
    return true
  }
  
  // Retry some API errors (5xx, timeouts)
  if (error.type === 'API' || isAPIError(error)) {
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
 * Execute operation with timeout
 */
const executeWithTimeout = async (operation, context) => {
  const timeout = getOperationTimeout(context)
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(createBaseError(`Operation timeout: ${context.operation || 'unknown'}`, true, 408))
    }, timeout)
  })
  
  return Promise.race([operation(), timeoutPromise])
}

/**
 * Attempt operation with retry logic
 */
const attemptOperation = async (operation, context, strategy, retryStats) => {
  const config = getRetryConfig(context, strategy)
  let lastError = null
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await executeWithTimeout(operation, context)
      
      // Success - reset retry stats
      resetRetryStats(context, retryStats)
      return result
      
    } catch (error) {
      lastError = error
      
      // Don't retry cancellation errors
      if (error.type === 'CANCELLATION' || isCancellationError(error)) {
        throw error
      }
      
      // Don't retry authentication errors
      if (isAuthenticationError(error)) {
        throw error
      }
      
      // Last attempt - don't wait
      if (attempt === config.maxAttempts) {
        break
      }
      
      // Check if we should retry this error
      if (!shouldRetryError(error)) {
        break
      }
      
      // Wait before retry with exponential backoff
      const delay = calculateBackoffDelay(attempt, config)
      logger.debug(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: error.message,
        context: generateOperationId(context)
      })
      
      await sleep(delay)
      recordRetryAttempt(context, attempt, error, retryStats)
    }
  }
  
  // All retries exhausted
  throw lastError
}

/**
 * Fail gracefully with safe defaults
 */
const failGracefully = (error, context) => {
  const operationId = generateOperationId(context)
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
const initiateShutdown = async (error, context) => {
  logger.error('Critical error - initiating graceful shutdown', {
    error: error.message,
    context: generateOperationId(context)
  })
  
  // Give time for cleanup
  setTimeout(() => {
    process.exit(1)
  }, 3000)
}

/**
 * Attempt fallback recovery
 */
const attemptFallback = async (error, originalOperation, context, fallbackHandlers) => {
  const pattern = getHandlerPattern(context)
  const handlers = fallbackHandlers.get(pattern) || fallbackHandlers.get('*') || []
  
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
  return failGracefully(error, context)
}

/**
 * Attempt recovery with registered handlers
 */
const attemptRecovery = async (error, context, recoveryHandlers) => {
  const pattern = getHandlerPattern(context)
  const handlers = recoveryHandlers.get(pattern) || recoveryHandlers.get('*') || []
  
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
  return failGracefully(error, context)
}

/**
 * Recover from error using appropriate strategy
 */
const recoverFromError = async (error, operation, context, strategy, state) => {
  const operationId = generateOperationId(context)
  
  switch (strategy) {
    case RecoveryStrategy.RETRY:
      // Already handled in attemptOperation
      throw error
      
    case RecoveryStrategy.FALLBACK:
      return await attemptFallback(error, operation, context, state.fallbackHandlers)
      
    case RecoveryStrategy.RECOVER:
      return await attemptRecovery(error, context, state.recoveryHandlers)
      
    case RecoveryStrategy.FAIL_GRACEFUL:
      return failGracefully(error, context)
      
    case RecoveryStrategy.SHUTDOWN:
      await initiateShutdown(error, context)
      throw error
      
    default:
      throw error
  }
}

/**
 * Record retry attempt
 */
const recordRetryAttempt = (context, attempt, error, retryStats) => {
  const operationId = generateOperationId(context)
  if (!retryStats.has(operationId)) {
    retryStats.set(operationId, [])
  }
  
  retryStats.get(operationId).push({
    attempt,
    error: error.message,
    timestamp: new Date()
  })
}

/**
 * Reset retry stats
 */
const resetRetryStats = (context, retryStats) => {
  const operationId = generateOperationId(context)
  retryStats.delete(operationId)
}

/**
 * Execute operation with automatic recovery
 */
const executeWithRecovery = async (operation, context = {}, strategy = RecoveryStrategy.RETRY, state) => {
  const operationId = generateOperationId(context)
  
  try {
    return await attemptOperation(operation, context, strategy, state.retryStats)
  } catch (error) {
    logger.debug(`Operation ${operationId} failed, attempting recovery`, {
      error: error.message,
      strategy,
      context
    })
    
    return await recoverFromError(error, operation, context, strategy, state)
  }
}

/**
 * Add fallback handler
 */
const addFallbackHandler = (pattern, handler, fallbackHandlers) => {
  if (!fallbackHandlers.has(pattern)) {
    fallbackHandlers.set(pattern, [])
  }
  fallbackHandlers.get(pattern).push(handler)
  
  logger.debug(`Registered fallback handler for pattern: ${pattern}`)
}

/**
 * Add recovery handler
 */
const addRecoveryHandler = (pattern, handler, recoveryHandlers) => {
  if (!recoveryHandlers.has(pattern)) {
    recoveryHandlers.set(pattern, [])
  }
  recoveryHandlers.get(pattern).push(handler)
  
  logger.debug(`Registered recovery handler for pattern: ${pattern}`)
}

/**
 * Create error recovery system factory function
 */
export const createErrorRecovery = () => {
  const state = {
    fallbackHandlers: new Map(),
    recoveryHandlers: new Map(),
    retryStats: new Map()
  }
  
  return {
    executeWithRecovery: (operation, context, strategy) => executeWithRecovery(operation, context, strategy, state),
    addFallbackHandler: (pattern, handler) => addFallbackHandler(pattern, handler, state.fallbackHandlers),
    addRecoveryHandler: (pattern, handler) => addRecoveryHandler(pattern, handler, state.recoveryHandlers),
    getRetryStats: () => Object.fromEntries(state.retryStats),
    
    // Utility functions
    shouldRetryError,
    calculateBackoffDelay,
    getOperationTimeout,
    getRetryConfig,
    generateOperationId,
    failGracefully,
    sleep
  }
}

// Global instance for backward compatibility
export const errorRecovery = createErrorRecovery()

// Export individual functions for functional usage
export {
  executeWithRecovery,
  attemptOperation,
  recoverFromError,
  attemptFallback,
  attemptRecovery,
  failGracefully,
  initiateShutdown,
  addFallbackHandler,
  addRecoveryHandler,
  shouldRetryError,
  calculateBackoffDelay,
  getOperationTimeout,
  getRetryConfig,
  generateOperationId,
  sleep
}