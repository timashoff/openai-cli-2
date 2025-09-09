/**
 * Unified Error System - Single Source of Truth for Functional Error Handling
 * Central export point for all error handling functionality
 */

// Core error type factories and utilities
export {
  createBaseError,
  createNetworkError,
  createAPIError,
  createValidationError,
  createCommandError,
  createSystemError,
  createCancellationError,
  createConfigurationError,
  createProviderError,
  createCacheError,
  createSecurityError,
  isNetworkError,
  isAPIError,
  isCancellationError,
  isValidationError,
  isSystemError,
  isBaseError,
  createFromGeneric
} from './ErrorTypes.js'


// Central error handler - factory and global instance
export {
  createErrorHandler,
  errorHandler,
  processError,
  handleError,
  formatError,
  logError,
  displayError,
  isSilentError,
  isTrustedError,
  sanitizeMessage
} from './ErrorHandler.js'

// Recovery system - factory and global instance
export {
  createErrorRecovery,
  errorRecovery,
  RecoveryStrategy,
  RetryConfig,
  executeWithRecovery,
  shouldRetryError,
  failGracefully
} from './ErrorRecovery.js'

// Circuit breaker and boundary - factories and global instance
export {
  createErrorBoundary,
  createCircuitBreaker,
  errorBoundary,
  CircuitState,
  CircuitConfig,
  execute,
  executeBatch,
  executeWithCircuit
} from './ErrorBoundary.js'

// Import functions for internal use
import { createErrorHandler } from './ErrorHandler.js'
import { createErrorRecovery, RecoveryStrategy, RetryConfig } from './ErrorRecovery.js'  
import { createErrorBoundary, CircuitState, CircuitConfig } from './ErrorBoundary.js'
import { 
  createFromGeneric, 
  isNetworkError,
  isAPIError,
  isCancellationError,
  isValidationError,
  isSystemError,
  isBaseError 
} from './ErrorTypes.js'

/**
 * Convenience functions for common error handling patterns
 */

/**
 * Handle error with automatic recovery using functional approach
 */
export async function handleWithRecovery(operation, context = {}, strategy = 'retry') {
  const { errorBoundary } = await import('./ErrorBoundary.js')
  return errorBoundary.execute(operation, context, strategy)
}

/**
 * Create typed error from generic error using functional factories
 */
export function createTypedError(error, defaultType = 'BASE') {
  return createFromGeneric(error, defaultType)
}

/**
 * Check if error is recoverable/operational using functional approach
 */
export function isRecoverableError(error) {
  return isBaseError(error) ? error.isOperational : false
}

/**
 * Get error system health status using functional approach
 */
export function getSystemHealth() {
  return errorBoundary.getHealthCheck()
}

/**
 * Factory function to create a complete error handling system
 */
export function createErrorSystem() {
  const errorHandlerInstance = createErrorHandler()
  const errorRecoveryInstance = createErrorRecovery()
  const errorBoundaryInstance = createErrorBoundary()
  
  return {
    // Error handling
    processError: errorHandlerInstance.processError,
    handleError: errorHandlerInstance.handleError,
    formatError: errorHandlerInstance.formatError,
    
    // Recovery and retry
    executeWithRecovery: errorRecoveryInstance.executeWithRecovery,
    addFallbackHandler: errorRecoveryInstance.addFallbackHandler,
    addRecoveryHandler: errorRecoveryInstance.addRecoveryHandler,
    
    // Circuit breaker protection
    execute: errorBoundaryInstance.execute,
    executeBatch: errorBoundaryInstance.executeBatch,
    getHealthCheck: errorBoundaryInstance.getHealthCheck,
    resetAllCircuits: errorBoundaryInstance.resetAllCircuits,
    
    // Error creation
    createError: createFromGeneric,
    createTypedError,
    
    // Error classification
    isRecoverableError,
    isNetworkError,
    isAPIError,
    isCancellationError,
    isValidationError,
    isSystemError,
    
    // Configuration
    RecoveryStrategy,
    RetryConfig,
    CircuitState,
    CircuitConfig
  }
}

/**
 * Global error system instance for convenience
 */
export const globalErrorSystem = createErrorSystem()