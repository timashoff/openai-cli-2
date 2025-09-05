/**
 * Central Error Handler - Single Source of Truth for error processing
 * Consolidates classification, formatting, sanitization, and logging
 */
import { color } from '../../config/color.js'
import { logger } from '../../utils/logger.js'
import * as ErrorTypes from './ErrorTypes.js'

const {
  BaseError,
  NetworkError,
  APIError,
  ValidationError,
  CancellationError,
  CommandError,
  SystemError,
  ErrorFactory,
} = ErrorTypes

/**
 * Central error handler with unified processing pipeline
 */
export class ErrorHandler {
  constructor() {
    this.setupGlobalHandlers()
  }

  /**
   * Main error processing pipeline
   */
  async processError(error, context = {}) {
    // Convert to typed error if needed
    const typedError = ErrorFactory.createFromGeneric(error)

    // Process the error
    const processedError = this.formatError(typedError, context)

    // Log if needed (skip cancellation errors)
    if (!this.isSilentError(typedError)) {
      await this.logError(processedError, context)
    }

    return processedError
  }

  /**
   * Handle and display error to user
   */
  async handleError(error, context = {}) {
    const processedError = await this.processError(error, context)

    // Display to user if needed
    if (processedError.shouldDisplay && processedError.userMessage) {
      this.displayError(processedError)
    }

    // Determine if application should exit
    if (!this.isTrustedError(processedError.originalError)) {
      console.error(
        `${color.red}Critical error detected. Application will exit.${color.reset}`,
      )
      process.exit(1)
    }

    return processedError
  }

  /**
   * Format error with context and user-friendly messages
   */
  formatError(error, context) {
    const baseError = {
      type: error.type || error.constructor.name,
      originalError: error,
      context,
      timestamp: new Date().toISOString(),
      shouldDisplay: true,
      userMessage: null,
      logLevel: 'error',
    }

    // Handle different error types
    if (error instanceof CancellationError) {
      return {
        ...baseError,
        shouldDisplay: false,
        userMessage: null,
        logLevel: 'debug',
      }
    }

    if (error instanceof NetworkError) {
      return {
        ...baseError,
        userMessage:
          'Network connection failed. Please check your internet connection.',
        logLevel: 'error',
      }
    }

    if (error instanceof APIError) {
      return {
        ...baseError,
        userMessage: this.sanitizeMessage(error.message),
        logLevel: 'error',
      }
    }

    if (error instanceof ValidationError) {
      return {
        ...baseError,
        userMessage: error.field
          ? `Input validation failed for '${error.field}': ${this.sanitizeMessage(error.message)}`
          : `Input validation failed: ${this.sanitizeMessage(error.message)}`,
        logLevel: 'warn',
      }
    }

    if (error instanceof CommandError) {
      return {
        ...baseError,
        userMessage: error.command
          ? `Command '${error.command}' failed: ${this.sanitizeMessage(error.message)}`
          : `Command failed: ${this.sanitizeMessage(error.message)}`,
        logLevel: 'error',
      }
    }

    if (error instanceof SystemError) {
      return {
        ...baseError,
        userMessage: 'System error occurred. Please try again.',
        logLevel: 'error',
      }
    }

    // Handle legacy error patterns for backward compatibility
    if (this.isUserInputError(error)) {
      return {
        ...baseError,
        userMessage: this.sanitizeMessage(error.message),
        logLevel: 'warn',
      }
    }

    if (this.isNetworkPattern(error)) {
      return {
        ...baseError,
        userMessage:
          'Network error. Please check your connection and try again.',
        logLevel: 'error',
      }
    }

    // Default error handling
    return {
      ...baseError,
      userMessage: `Error: ${this.sanitizeMessage(error.message)}`,
      logLevel: 'error',
    }
  }

  /**
   * Log error with proper sanitization and context
   */
  async logError(processedError, context) {
    const { logLevel, type, originalError } = processedError
    const contextInfo = context.component ? ` [${context.component}]` : ''

    const sanitizedMessage = this.sanitizeMessage(originalError.message)
    const message = `${type} error${contextInfo}: ${sanitizedMessage}`

    const sanitizedStack = originalError.stack
      ? this.sanitizeMessage(originalError.stack)
      : undefined

    switch (logLevel) {
      case 'debug':
        logger.debug(message)
        break
      case 'warn':
        logger.warn(message)
        break
      case 'error':
      default:
        logger.error(message, sanitizedStack ? { stack: sanitizedStack } : {})
        break
    }
  }

  /**
   * Display error to user with proper formatting
   */
  displayError(processedError) {
    const { userMessage, originalError } = processedError

    // For user input errors, show formatted message as-is
    if (this.isUserInputError(originalError)) {
      console.log(userMessage)
      return
    }

    // For operational errors, show with color
    if (originalError.isOperational) {
      console.log(`${color.red}${userMessage}${color.reset}`)
      return
    }

    // Default error display
    console.error(`${color.red}${userMessage}${color.reset}`)
  }

  /**
   * Check if error should not be logged (silent errors)
   */
  isSilentError(error) {
    return error instanceof CancellationError || error.shouldDisplay === false
  }

  /**
   * Check if error is trusted (operational, recoverable)
   */
  isTrustedError(error) {
    if (error instanceof BaseError) {
      return error.isOperational
    }

    // Backward compatibility checks
    if (error.isUserInputError || error.requiresPrompt) {
      return true
    }

    if (error.isOperational) {
      return true
    }

    if (error.message && error.message.includes('requires additional input')) {
      return true
    }

    return false
  }

  /**
   * Legacy pattern detection for backward compatibility
   */
  isUserInputError(error) {
    return error.isUserInputError || error.requiresPrompt
  }

  isNetworkPattern(error) {
    if (!error.message) return false

    return (
      error.message.includes('Failed to create chat completion') ||
      error.message.includes('Request timed out') ||
      error.message.includes('timeout') ||
      error.message.includes('Authentication') ||
      error.message.includes('Rate limit') ||
      error.message.includes('terminated') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('network') ||
      error.message.includes('fetch failed')
    )
  }

  /**
   * Sanitize error messages to prevent secrets exposure
   */
  sanitizeMessage(message) {
    if (!message || typeof message !== 'string') {
      return message || 'Unknown error'
    }

    let sanitized = message

    // Remove API keys, tokens, and other sensitive data
    sanitized = sanitized.replace(
      /api[_-]?key[s]?[:\s]*[a-zA-Z0-9_-]+/gi,
      'api_key: [REDACTED]',
    )
    sanitized = sanitized.replace(
      /token[s]?[:\s]*[a-zA-Z0-9_.-]+/gi,
      'token: [REDACTED]',
    )
    sanitized = sanitized.replace(
      /password[s]?[:\s]*\S+/gi,
      'password: [REDACTED]',
    )
    sanitized = sanitized.replace(/secret[s]?[:\s]*\S+/gi, 'secret: [REDACTED]')
    sanitized = sanitized.replace(
      /authorization[:\s]*bearer\s+\S+/gi,
      'authorization: Bearer [REDACTED]',
    )
    sanitized = sanitized.replace(
      /x-api-key[:\s]*\S+/gi,
      'x-api-key: [REDACTED]',
    )

    // Remove common key patterns
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]+/g, 'sk-[REDACTED]')
    sanitized = sanitized.replace(/pk-[a-zA-Z0-9]+/g, 'pk-[REDACTED]')
    sanitized = sanitized.replace(/[a-zA-Z0-9]{32,}/g, (match) => {
      return match.length > 32 ? '[REDACTED-KEY]' : match
    })

    return sanitized
  }

  /**
   * Setup global error handlers
   */
  setupGlobalHandlers() {
    process.on('uncaughtException', (error) => {
      const sanitizedMessage = this.sanitizeMessage(error.message)
      console.error(
        `${color.red}Uncaught Exception:${color.reset}`,
        sanitizedMessage,
      )

      // Simple fallback without circular dependencies
      if (!this.isTrustedError(error)) {
        console.error(
          `${color.red}Critical error detected. Application will exit.${color.reset}`,
        )
        process.exit(1)
      }
    })

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      const sanitizedReason = this.sanitizeMessage(error.message)
      console.error(
        `${color.red}Unhandled Rejection:${color.reset}`,
        sanitizedReason,
      )

      // Simple fallback without circular dependencies
      if (!this.isTrustedError(error)) {
        console.error(
          `${color.red}Critical error detected. Application will exit.${color.reset}`,
        )
        process.exit(1)
      }
    })
  }
}

// Global instance
export const errorHandler = new ErrorHandler()
