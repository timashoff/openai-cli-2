import { color } from '../config/color.js'
import { sanitizeErrorMessage } from './security.js'

export class AppError extends Error {
  constructor(message, isOperational = true, statusCode = 500) {
    super(message)
    
    Object.setPrototypeOf(this, new.target.prototype)
    
    this.isOperational = isOperational
    this.statusCode = statusCode
    
    Error.captureStackTrace(this)
  }
}

class ErrorHandler {
  constructor() {
    this.logger = console
  }

  async handleError(error) {
    // User cancellation is now handled properly through signal.aborted
    // No need to check error messages
    
    await this.logError(error)
    
    if (!this.isTrustedError(error)) {
      console.error(`${color.red}Critical error detected. Application will exit.${color.reset}`)
      process.exit(1)
    }
  }

  async logError(error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message)
    
    // For user input errors, show the formatted message as-is (already colored)
    if (error.isUserInputError || error.requiresPrompt) {
      console.log(sanitizedMessage)
      return
    }
    
    // For operational errors, show only the message to the user
    if (error.isOperational) {
      console.log(`${color.red}${sanitizedMessage}${color.reset}`)
      return
    }
    
    // For most user-facing errors, just show the message
    if (error.message && (
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
    )) {
      console.log(`${color.red}Network error. Please check your connection and try again.${color.reset}`)
      return
    }
    
    // For system errors, show full technical details
    const sanitizedStack = error.stack ? sanitizeErrorMessage(error.stack) : 'No stack trace'
    
    this.logger.error(`${color.red}Error:${color.reset}`, {
      message: sanitizedMessage,
      stack: sanitizedStack,
      timestamp: new Date().toISOString(),
      isOperational: error.isOperational || false
    })
  }

  isTrustedError(error) {
    if (error instanceof AppError) {
      return error.isOperational
    }
    
    // Trust user input errors - these are recoverable operational errors
    if (error.isUserInputError || error.requiresPrompt) {
      return true
    }
    
    // Trust operational errors
    if (error.isOperational) {
      return true
    }
    
    // AbortError is now handled properly at source - no special treatment needed
    
    // Trust command requirement errors (missing arguments)
    if (error.message && error.message.includes('requires additional input')) {
      return true
    }
    
    return false
  }
}

export const errorHandler = new ErrorHandler()

// Handling unhandled errors
process.on('uncaughtException', (error) => {
  // User cancellation is handled properly at source now
  const sanitizedMessage = sanitizeErrorMessage(error.message)
  console.error(`${color.red}Uncaught Exception:${color.reset}`, sanitizedMessage)
  errorHandler.handleError(error)
})

process.on('unhandledRejection', (reason) => {
  // User cancellation is handled properly at source now
  const reasonStr = String(reason)
  const sanitizedReason = sanitizeErrorMessage(reasonStr)
  console.error(`${color.red}Unhandled Rejection:${color.reset}`, sanitizedReason)
  errorHandler.handleError(reason instanceof Error ? reason : new Error(reasonStr))
})
