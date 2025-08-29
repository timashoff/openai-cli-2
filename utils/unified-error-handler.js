/**
 * Unified Error Handler - Single source of truth for all error handling
 * Consolidates error processing from scattered handlers across the application
 */
import { logger } from './logger.js'

export class UnifiedErrorHandler {
  constructor() {
    this.errorTypes = {
      ABORT_ERROR: 'abort',
      NETWORK_ERROR: 'network',
      API_ERROR: 'api',
      VALIDATION_ERROR: 'validation',
      COMMAND_ERROR: 'command',
      SYSTEM_ERROR: 'system',
      UNKNOWN_ERROR: 'unknown'
    }
  }

  processError(error, context = {}) {
    const errorType = this.classifyError(error)
    const processedError = this.formatError(error, errorType, context)
    
    // Log error (unless it's user cancellation)
    if (errorType !== this.errorTypes.ABORT_ERROR) {
      this.logError(processedError, context)
    }
    
    return processedError
  }

  classifyError(error) {
    // User cancellation (ESC key) - highest priority
    if (this.isAbortError(error)) {
      return this.errorTypes.ABORT_ERROR
    }
    
    if (this.isNetworkError(error)) {
      return this.errorTypes.NETWORK_ERROR
    }
    
    if (this.isAPIError(error)) {
      return this.errorTypes.API_ERROR
    }
    
    if (this.isValidationError(error)) {
      return this.errorTypes.VALIDATION_ERROR
    }
    
    if (this.isCommandError(error)) {
      return this.errorTypes.COMMAND_ERROR
    }
    
    if (this.isSystemError(error)) {
      return this.errorTypes.SYSTEM_ERROR
    }
    
    return this.errorTypes.UNKNOWN_ERROR
  }

  formatError(error, errorType, context) {
    const baseError = {
      type: errorType,
      originalError: error,
      context,
      shouldDisplay: true,
      timestamp: new Date().toISOString()
    }

    switch (errorType) {
      case this.errorTypes.ABORT_ERROR:
        return {
          ...baseError,
          userMessage: null, // Silent cancellation - no message
          shouldDisplay: false,
          logLevel: 'debug'
        }

      case this.errorTypes.NETWORK_ERROR:
        return {
          ...baseError,
          userMessage: 'Network connection failed. Please check your internet connection.',
          logLevel: 'error'
        }

      case this.errorTypes.API_ERROR:
        return {
          ...baseError,
          userMessage: this.sanitizeMessage(error.message),
          logLevel: 'error'
        }

      case this.errorTypes.VALIDATION_ERROR:
        return {
          ...baseError,
          userMessage: `Input validation failed: ${this.sanitizeMessage(error.message)}`,
          logLevel: 'warn'
        }

      case this.errorTypes.COMMAND_ERROR:
        return {
          ...baseError,
          userMessage: `Command failed: ${this.sanitizeMessage(error.message)}`,
          logLevel: 'error'
        }

      case this.errorTypes.SYSTEM_ERROR:
        return {
          ...baseError,
          userMessage: 'System error occurred. Please try again.',
          logLevel: 'error'
        }

      default:
        return {
          ...baseError,
          userMessage: `Error: ${this.sanitizeMessage(error.message)}`,
          logLevel: 'error'
        }
    }
  }

  logError(processedError, context) {
    const { logLevel, type, originalError } = processedError
    const contextInfo = context.component ? ` [${context.component}]` : ''
    
    // CRITICAL: Sanitize error message before logging to prevent secrets exposure
    const sanitizedMessage = this.sanitizeMessage(originalError.message)
    const message = `${type.toUpperCase()} error${contextInfo}: ${sanitizedMessage}`
    
    // Also sanitize stack trace if present
    const sanitizedStack = originalError.stack ? this.sanitizeMessage(originalError.stack) : undefined
    
    switch (logLevel) {
      case 'debug':
        logger.debug(message)
        break
      case 'warn':
        logger.warn(message)
        break
      case 'error':
      default:
        logger.error(message, sanitizedStack)
        break
    }
  }

  displayError(processedError, outputInterface = null) {
    if (!processedError.shouldDisplay || !processedError.userMessage) {
      return // Silent error (like user cancellation)
    }

    if (outputInterface && outputInterface.writeOutput) {
      outputInterface.writeOutput(processedError.userMessage)
    } else {
      // Fallback to console output
      console.error(processedError.userMessage)
    }
  }

  handleAndDisplayError(error, outputInterface = null, context = {}) {
    const processedError = this.processError(error, context)
    this.displayError(processedError, outputInterface)
    return processedError
  }

  // Error type detection methods

  isAbortError(error) {
    const errorString = String(error).toLowerCase()
    const messageString = (error.message || '').toLowerCase()
    
    return errorString.includes('aborterror') ||
           messageString.includes('aborted') ||
           messageString.includes('cancelled') ||
           error.code === 'ABORT_ERR'
  }

  isNetworkError(error) {
    return error.code === 'ENOTFOUND' ||
           error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.message.includes('network') ||
           error.message.includes('fetch')
  }

  isAPIError(error) {
    return error.status >= 400 ||
           error.response ||
           error.message.includes('API') ||
           error.message.includes('authentication')
  }

  isValidationError(error) {
    return error.name === 'ValidationError' ||
           error.message.includes('validation') ||
           error.message.includes('invalid input')
  }

  isCommandError(error) {
    return error.message.includes('command') ||
           error.message.includes('unknown command') ||
           error.message.includes('Command not found')
  }

  isSystemError(error) {
    return error.code === 'EACCES' ||
           error.code === 'EPERM' ||
           error.message.includes('permission') ||
           error.message.includes('system')
  }

  sanitizeMessage(message) {
    if (!message || typeof message !== 'string') {
      return message
    }

    let sanitized = message

    // Remove API keys, tokens, and other sensitive data
    sanitized = sanitized.replace(/api[_-]?key[s]?[:\s]*[a-zA-Z0-9_-]+/gi, 'api_key: [REDACTED]')
    sanitized = sanitized.replace(/token[s]?[:\s]*[a-zA-Z0-9_.-]+/gi, 'token: [REDACTED]')
    sanitized = sanitized.replace(/password[s]?[:\s]*\S+/gi, 'password: [REDACTED]')
    sanitized = sanitized.replace(/secret[s]?[:\s]*\S+/gi, 'secret: [REDACTED]')
    sanitized = sanitized.replace(/authorization[:\s]*bearer\s+\S+/gi, 'authorization: Bearer [REDACTED]')
    sanitized = sanitized.replace(/x-api-key[:\s]*\S+/gi, 'x-api-key: [REDACTED]')

    // Remove common patterns that might contain secrets
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]+/g, 'sk-[REDACTED]') // OpenAI keys
    sanitized = sanitized.replace(/pk-[a-zA-Z0-9]+/g, 'pk-[REDACTED]') // Public keys
    sanitized = sanitized.replace(/[a-zA-Z0-9]{32,}/g, (match) => {
      // Replace long alphanumeric strings that might be keys
      return match.length > 32 ? '[REDACTED-KEY]' : match
    })

    return sanitized
  }
}

export function createUnifiedErrorHandler() {
  return new UnifiedErrorHandler()
}

// Default global instance
export const unifiedErrorHandler = new UnifiedErrorHandler()