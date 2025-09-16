/**
 * Central Error Handler - Functional error processing system  
 * Consolidates classification, formatting, sanitization, and logging
 */
import { ANSI } from '../../config/ansi.js'
import { logger } from '../../utils/logger.js'
import { 
  createFromGeneric,
  isCancellationError,
  isNetworkError,
  isAPIError,
  isValidationError,
  isSystemError,
  isBaseError
} from './ErrorTypes.js'

/**
 * Process error through the main pipeline
 */
const processError = async (error, context = {}) => {
  // Convert to typed error if needed
  const typedError = createFromGeneric(error)

  // Process the error
  const processedError = formatError(typedError, context)

  // Log if needed (skip cancellation errors)
  if (!isSilentError(typedError)) {
    await logError(processedError, context)
  }

  return processedError
}

/**
 * Handle and display error to user
 */
const handleError = async (error, context = {}) => {
  const processedError = await processError(error, context)

  // Display to user if needed
  if (processedError.shouldDisplay && processedError.userMessage) {
    displayError(processedError)
  }

  // Determine if application should exit
  if (!isTrustedError(processedError.originalError)) {
    console.error(
      `${ANSI.COLORS.RED}Critical error detected. Application will exit.${ANSI.COLORS.RESET}`,
    )
    process.exit(1)
  }

  return processedError
}

/**
 * Format error with context and user-friendly messages
 */
const formatError = (error, context) => {
  const baseError = {
    type: error.type || error.name || 'UnknownError',
    originalError: error,
    context,
    timestamp: new Date().toISOString(),
    shouldDisplay: true,
    userMessage: null,
    logLevel: 'error',
  }

  // Handle different error types
  if (error.type === 'CANCELLATION') {
    return {
      ...baseError,
      shouldDisplay: false,
      userMessage: null,
      logLevel: 'debug',
    }
  }

  if (error.type === 'NETWORK') {
    return {
      ...baseError,
      userMessage:
        'Network connection failed. Please check your internet connection.',
      logLevel: 'error',
    }
  }

  if (error.type === 'API') {
    return {
      ...baseError,
      userMessage: sanitizeMessage(error.message),
      logLevel: 'error',
    }
  }

  if (error.type === 'VALIDATION') {
    return {
      ...baseError,
      userMessage: error.field
        ? `Input validation failed for '${error.field}': ${sanitizeMessage(error.message)}`
        : `Input validation failed: ${sanitizeMessage(error.message)}`,
      logLevel: 'warn',
    }
  }

  if (error.type === 'COMMAND') {
    return {
      ...baseError,
      userMessage: error.command
        ? `Command '${error.command}' failed: ${sanitizeMessage(error.message)}`
        : `Command failed: ${sanitizeMessage(error.message)}`,
      logLevel: 'error',
    }
  }

  if (error.type === 'SYSTEM') {
    return {
      ...baseError,
      userMessage: 'System error occurred. Please try again.',
      logLevel: 'error',
    }
  }

  // Handle legacy error patterns for backward compatibility
  if (isUserInputError(error)) {
    return {
      ...baseError,
      userMessage: sanitizeMessage(error.message),
      logLevel: 'warn',
    }
  }

  if (isNetworkPattern(error)) {
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
    userMessage: `Error: ${sanitizeMessage(error.message)}`,
    logLevel: 'error',
  }
}

/**
 * Log error with proper sanitization and context
 */
const logError = async (processedError, context) => {
  const { logLevel, type, originalError } = processedError
  const contextInfo = context.component ? ` [${context.component}]` : ''

  const sanitizedMessage = sanitizeMessage(originalError.message)
  const message = `${type} error${contextInfo}: ${sanitizedMessage}`

  const sanitizedStack = originalError.stack
    ? sanitizeMessage(originalError.stack)
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
      // Zero Trust: Console gets only safe message, NO stack traces
      logger.error(message)

      // Stack traces only in development file logs for debugging
      if (process.env.NODE_ENV === 'development' && sanitizedStack) {
        logger.debug(`Stack trace: ${sanitizedStack}`)
      }
      break
  }
}

/**
 * Display error to user with proper formatting
 */
const displayError = (processedError) => {
  const { userMessage, originalError } = processedError

  // For user input errors, show formatted message as-is
  if (isUserInputError(originalError)) {
    console.log(userMessage)
    return
  }

  // For operational errors, show with color
  if (originalError.isOperational) {
    console.log(`${ANSI.COLORS.RED}${userMessage}${ANSI.COLORS.RESET}`)
    return
  }

  // Default error display
  console.error(`${ANSI.COLORS.RED}${userMessage}${ANSI.COLORS.RESET}`)
}

/**
 * Check if error should not be logged (silent errors)
 */
const isSilentError = (error) => {
  return error.type === 'CANCELLATION' || error.shouldDisplay === false
}

/**
 * Check if error is trusted (operational, recoverable)
 */
const isTrustedError = (error) => {
  if (isBaseError(error)) {
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
const isUserInputError = (error) => {
  return error.isUserInputError || error.requiresPrompt
}

const isNetworkPattern = (error) => {
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
const sanitizeMessage = (message) => {
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
const setupGlobalHandlers = () => {
  process.on('uncaughtException', (error) => {
    const sanitizedMessage = sanitizeMessage(error.message)
    console.error(
      `${ANSI.COLORS.RED}Uncaught Exception:${ANSI.COLORS.RESET}`,
      sanitizedMessage,
    )

    // Simple fallback without circular dependencies
    if (!isTrustedError(error)) {
      console.error(
        `${ANSI.COLORS.RED}Critical error detected. Application will exit.${ANSI.COLORS.RESET}`,
      )
      process.exit(1)
    }
  })

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    const sanitizedReason = sanitizeMessage(error.message)
    console.error(
      `${ANSI.COLORS.RED}Unhandled Rejection:${ANSI.COLORS.RESET}`,
      sanitizedReason,
    )

    // Simple fallback without circular dependencies
    if (!isTrustedError(error)) {
      console.error(
        `${ANSI.COLORS.RED}Critical error detected. Application will exit.${ANSI.COLORS.RESET}`,
      )
      process.exit(1)
    }
  })
}

/**
 * Create error handler factory function
 */
const createErrorHandlerInstance = () => {
  // Set up global handlers once
  setupGlobalHandlers()
  
  return {
    processError,
    handleError,
    formatError,
    logError,
    displayError,
    isSilentError,
    isTrustedError,
    isUserInputError,
    isNetworkPattern,
    sanitizeMessage,
    setupGlobalHandlers
  }
}

// Export factory function
export const createErrorHandler = createErrorHandlerInstance

// Global instance for backward compatibility
export const errorHandler = createErrorHandlerInstance()

// Export individual functions for functional usage
export {
  processError,
  handleError,
  formatError,
  logError,
  displayError,
  isSilentError,
  isTrustedError,
  isUserInputError,
  isNetworkPattern,
  sanitizeMessage,
  setupGlobalHandlers
}