/**
 * Specialized Error Classes - Type-safe error hierarchy
 * Single Source of Truth for all application error types
 */

/**
 * Base application error with operational flag and status code
 */
export class BaseError extends Error {
  constructor(message, isOperational = true, statusCode = 500) {
    super(message)
    
    Object.setPrototypeOf(this, new.target.prototype)
    
    this.name = this.constructor.name
    this.isOperational = isOperational
    this.statusCode = statusCode
    this.timestamp = new Date().toISOString()
    
    Error.captureStackTrace(this, this.constructor)
  }
}

/**
 * Network-related errors (connection, timeout, DNS)
 */
export class NetworkError extends BaseError {
  constructor(message, details = {}) {
    super(message, true, 503)
    this.type = 'NETWORK'
    this.details = details
  }
}

/**
 * API-related errors (authentication, rate limits, API responses)
 */
export class APIError extends BaseError {
  constructor(message, statusCode = 400, details = {}) {
    super(message, true, statusCode)
    this.type = 'API'
    this.details = details
  }
}

/**
 * User input validation errors
 */
export class ValidationError extends BaseError {
  constructor(message, field = null) {
    super(message, true, 400)
    this.type = 'VALIDATION'
    this.field = field
  }
}

/**
 * Command execution errors
 */
export class CommandError extends BaseError {
  constructor(message, command = null) {
    super(message, true, 400)
    this.type = 'COMMAND'
    this.command = command
  }
}

/**
 * System-level errors (permissions, file system)
 */
export class SystemError extends BaseError {
  constructor(message, code = null) {
    super(message, false, 500)
    this.type = 'SYSTEM'
    this.code = code
  }
}

/**
 * User cancellation (ESC key, Ctrl+C)
 */
export class CancellationError extends BaseError {
  constructor(message = 'Operation cancelled') {
    super(message, true, 499)
    this.type = 'CANCELLATION'
    this.shouldDisplay = false // Silent cancellation
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends BaseError {
  constructor(message, configKey = null) {
    super(message, true, 500)
    this.type = 'CONFIGURATION'
    this.configKey = configKey
  }
}

/**
 * Provider-specific errors (OpenAI, Anthropic, etc.)
 */
export class ProviderError extends BaseError {
  constructor(message, provider = null, statusCode = 500) {
    super(message, true, statusCode)
    this.type = 'PROVIDER'
    this.provider = provider
  }
}

/**
 * Cache operation errors
 */
export class CacheError extends BaseError {
  constructor(message, operation = null) {
    super(message, true, 500)
    this.type = 'CACHE'
    this.operation = operation
  }
}

/**
 * Security-related errors
 */
export class SecurityError extends BaseError {
  constructor(message, securityType = null) {
    super(message, false, 403)
    this.type = 'SECURITY'
    this.securityType = securityType
  }
}

/**
 * Error type detection utilities
 */
export const ErrorClassifier = {
  isNetworkError(error) {
    return error instanceof NetworkError ||
           error.code === 'ENOTFOUND' ||
           error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ECONNRESET' ||
           (error.message && (
             error.message.includes('network') ||
             error.message.includes('fetch failed') ||
             error.message.includes('timeout')
           ))
  },

  isAPIError(error) {
    return error instanceof APIError ||
           (error.status && error.status >= 400) ||
           error.response ||
           (error.message && (
             error.message.includes('API') ||
             error.message.includes('authentication') ||
             error.message.includes('rate limit')
           ))
  },

  isCancellationError(error) {
    return error instanceof CancellationError ||
           error.name === 'AbortError' ||
           (error.message && (
             error.message.toLowerCase().includes('abort') ||
             error.message.toLowerCase().includes('cancel')
           ))
  },

  isValidationError(error) {
    return error instanceof ValidationError ||
           error.name === 'ValidationError' ||
           (error.message && error.message.includes('validation'))
  },

  isSystemError(error) {
    return error instanceof SystemError ||
           error.code === 'EACCES' ||
           error.code === 'EPERM' ||
           (error.message && (
             error.message.includes('permission') ||
             error.message.includes('EACCES') ||
             error.message.includes('EPERM')
           ))
  }
}

/**
 * Error factory for creating typed errors from generic errors
 */
export const ErrorFactory = {
  createFromGeneric(error, defaultType = 'BaseError') {
    if (error instanceof BaseError) {
      return error // Already typed
    }

    // Classify and convert to appropriate type
    if (ErrorClassifier.isCancellationError(error)) {
      return new CancellationError(error.message)
    }
    
    if (ErrorClassifier.isNetworkError(error)) {
      return new NetworkError(error.message, { originalError: error })
    }
    
    if (ErrorClassifier.isAPIError(error)) {
      return new APIError(error.message, error.status || 500, { originalError: error })
    }
    
    if (ErrorClassifier.isValidationError(error)) {
      return new ValidationError(error.message)
    }
    
    if (ErrorClassifier.isSystemError(error)) {
      return new SystemError(error.message, error.code)
    }

    // Default fallback
    return new BaseError(error.message || String(error), true, 500)
  }
}