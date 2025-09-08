/**
 * Unified Error System - Single Source of Truth
 * Central export point for all error handling functionality
 */

// Core error types and utilities
export {
  BaseError,
  NetworkError,
  APIError,
  ValidationError,
  CommandError,
  SystemError,
  CancellationError,
  ConfigurationError,
  ProviderError,
  CacheError,
  SecurityError,
  ErrorClassifier,
  ErrorFactory
} from './ErrorTypes.js'

// Central error handler
export {
  ErrorHandler,
  errorHandler
} from './ErrorHandler.js'

// Recovery system
export {
  ErrorRecovery,
  errorRecovery,
  RecoveryStrategy,
  RetryConfig
} from './ErrorRecovery.js'

// Circuit breaker and boundary
export {
  ErrorBoundary,
  errorBoundary,
  CircuitState,
  CircuitConfig
} from './ErrorBoundary.js'

/**
 * Convenience functions for common error handling patterns
 */

/**
 * Handle error with automatic recovery
 */
export async function handleWithRecovery(operation, context = {}, strategy = 'retry') {
  const { errorBoundary } = await import('./ErrorBoundary.js')
  return errorBoundary.execute(operation, context, strategy)
}

/**
 * Process and format error for user display
 */
export async function processError(error, context = {}) {
  const { errorHandler } = await import('./ErrorHandler.js')
  return errorHandler.processError(error, context)
}

/**
 * Handle error and display to user
 */
export async function handleError(error, context = {}) {
  const { errorHandler } = await import('./ErrorHandler.js')
  return errorHandler.handleError(error, context)
}

/**
 * Create typed error from generic error
 */
export function createTypedError(error, defaultType = 'BaseError') {
  return ErrorFactory.createFromGeneric(error, defaultType)
}

/**
 * Check if error is recoverable/operational
 */
export function isRecoverableError(error) {
  return error instanceof BaseError ? error.isOperational : false
}

/**
 * Get error system health status
 */
export function getSystemHealth() {
  return errorBoundary.getHealthCheck()
}


