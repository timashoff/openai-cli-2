/**
 * Specialized Error Factory Functions - Functional error type system
 * Single Source of Truth for all application error types
 */

/**
 * Base error factory function - creates functional error objects
 */
export const createBaseError = (message, isUserInputError = false, statusCode = 500) => {
  const error = new Error(message)
  
  return {
    ...error,
    name: 'BaseError',
    message,
    isUserInputError,
    isOperational: true,
    statusCode,
    timestamp: new Date().toISOString(),
    type: 'BASE',
    stack: error.stack
  }
}

/**
 * Network-related error factory (connection, timeout, DNS)
 */
export const createNetworkError = (message, details = {}) => {
  const baseError = createBaseError(message, true, 503)
  
  return {
    ...baseError,
    name: 'NetworkError',
    type: 'NETWORK',
    details
  }
}

/**
 * API-related error factory (authentication, rate limits, API responses)
 */
export const createAPIError = (message, statusCode = 400, details = {}) => {
  const baseError = createBaseError(message, true, statusCode)
  
  return {
    ...baseError,
    name: 'APIError',
    type: 'API',
    statusCode,
    details
  }
}

/**
 * User input validation error factory
 */
export const createValidationError = (message, field = null) => {
  const baseError = createBaseError(message, true, 400)
  
  return {
    ...baseError,
    name: 'ValidationError',
    type: 'VALIDATION',
    field
  }
}

/**
 * Command execution error factory
 */
export const createCommandError = (message, command = null) => {
  const baseError = createBaseError(message, true, 400)
  
  return {
    ...baseError,
    name: 'CommandError',
    type: 'COMMAND',
    command
  }
}

/**
 * System-level error factory (permissions, file system)
 */
export const createSystemError = (message, code = null) => {
  const baseError = createBaseError(message, false, 500)
  
  return {
    ...baseError,
    name: 'SystemError',
    type: 'SYSTEM',
    code
  }
}

/**
 * User cancellation error factory (ESC key, Ctrl+C)
 */
export const createCancellationError = (message = 'Operation cancelled') => {
  const baseError = createBaseError(message, true, 499)
  
  return {
    ...baseError,
    name: 'CancellationError',
    type: 'CANCELLATION',
    shouldDisplay: false // Silent cancellation
  }
}

/**
 * Configuration error factory
 */
export const createConfigurationError = (message, configKey = null) => {
  const baseError = createBaseError(message, true, 500)
  
  return {
    ...baseError,
    name: 'ConfigurationError',
    type: 'CONFIGURATION',
    configKey
  }
}

/**
 * Provider-specific error factory (OpenAI, Anthropic, etc.)
 */
export const createProviderError = (message, provider = null, statusCode = 500) => {
  const baseError = createBaseError(message, true, statusCode)
  
  return {
    ...baseError,
    name: 'ProviderError',
    type: 'PROVIDER',
    provider
  }
}

/**
 * Cache operation error factory
 */
export const createCacheError = (message, operation = null) => {
  const baseError = createBaseError(message, true, 500)
  
  return {
    ...baseError,
    name: 'CacheError',
    type: 'CACHE',
    operation
  }
}

/**
 * Security-related error factory
 */
export const createSecurityError = (message, securityType = null) => {
  const baseError = createBaseError(message, false, 403)
  
  return {
    ...baseError,
    name: 'SecurityError',
    type: 'SECURITY',
    securityType
  }
}

/**
 * Error type detection utilities - pure functions
 */
export const isNetworkError = (error) => {
  return error.type === 'NETWORK' ||
         error.name === 'NetworkError' ||
         error.code === 'ENOTFOUND' ||
         error.code === 'ECONNREFUSED' ||
         error.code === 'ETIMEDOUT' ||
         error.code === 'ECONNRESET' ||
         (error.message && (
           error.message.includes('network') ||
           error.message.includes('fetch failed') ||
           error.message.includes('timeout')
         ))
}

export const isAPIError = (error) => {
  return error.type === 'API' ||
         error.name === 'APIError' ||
         (error.status && error.status >= 400) ||
         error.response ||
         (error.message && (
           error.message.includes('API') ||
           error.message.includes('authentication') ||
           error.message.includes('rate limit')
         ))
}

export const isCancellationError = (error) => {
  return error.type === 'CANCELLATION' ||
         error.name === 'CancellationError' ||
         error.name === 'AbortError' ||
         (error.message && (
           error.message.toLowerCase().includes('abort') ||
           error.message.toLowerCase().includes('cancel')
         ))
}

export const isValidationError = (error) => {
  return error.type === 'VALIDATION' ||
         error.name === 'ValidationError' ||
         (error.message && error.message.includes('validation'))
}

export const isSystemError = (error) => {
  return error.type === 'SYSTEM' ||
         error.name === 'SystemError' ||
         error.code === 'EACCES' ||
         error.code === 'EPERM' ||
         (error.message && (
           error.message.includes('permission') ||
           error.message.includes('EACCES') ||
           error.message.includes('EPERM')
         ))
}

export const isBaseError = (error) => {
  return error.type && ['BASE', 'NETWORK', 'API', 'VALIDATION', 'COMMAND', 'SYSTEM', 'CANCELLATION', 'CONFIGURATION', 'PROVIDER', 'CACHE', 'SECURITY'].includes(error.type)
}

/**
 * Error factory for creating typed errors from generic errors
 */
export const createFromGeneric = (error, defaultType = 'BASE') => {
  if (isBaseError(error)) {
    return error // Already typed
  }

  // Classify and convert to appropriate type
  if (isCancellationError(error)) {
    return createCancellationError(error.message)
  }
  
  if (isNetworkError(error)) {
    return createNetworkError(error.message, { originalError: error })
  }
  
  if (isAPIError(error)) {
    return createAPIError(error.message, error.status || 500, { originalError: error })
  }
  
  if (isValidationError(error)) {
    return createValidationError(error.message)
  }
  
  if (isSystemError(error)) {
    return createSystemError(error.message, error.code)
  }

  // Default fallback
  return createBaseError(error.message || String(error), true, 500)
}

// Legacy compatibility exports - maintain backward compatibility
export const BaseError = createBaseError
export const NetworkError = createNetworkError
export const APIError = createAPIError
export const ValidationError = createValidationError
export const CommandError = createCommandError
export const SystemError = createSystemError
export const CancellationError = createCancellationError
export const ConfigurationError = createConfigurationError
export const ProviderError = createProviderError
export const CacheError = createCacheError
export const SecurityError = createSecurityError

export const ErrorClassifier = {
  isNetworkError,
  isAPIError,
  isCancellationError,
  isValidationError,
  isSystemError
}

export const ErrorFactory = {
  createFromGeneric
}