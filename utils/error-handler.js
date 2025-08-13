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
    // Skip logging for user cancellation (Ctrl+C, ESC, etc.)
    if (error.message && (error.message.includes('Aborted with Ctrl+C') ||
        error.message === 'AbortError' || error.name === 'AbortError' ||
        error.message.includes('aborted') || error.message.includes('cancelled'))) {
      return
    }
    
    await this.logError(error)
    
    if (!this.isTrustedError(error)) {
      console.error(`${color.red}Critical error detected. Application will exit.${color.reset}`)
      process.exit(1)
    }
  }

  async logError(error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message)
    
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
    
    // Trust AbortError - user cancellation is not a system failure
    if (error.name === 'AbortError' || error.message === 'AbortError' ||
        error.message.includes('aborted') || error.message.includes('cancelled') ||
        error.message.includes('Aborted with Ctrl+C')) {
      return true
    }
    
    return false
  }
}

export const errorHandler = new ErrorHandler()

// Handling unhandled errors
process.on('uncaughtException', (error) => {
  // Skip user cancellation errors
  if (error.message && (error.message.includes('Aborted with Ctrl+C') ||
      error.message === 'AbortError' || error.name === 'AbortError' ||
      error.message.includes('aborted') || error.message.includes('cancelled'))) {
    return
  }
  const sanitizedMessage = sanitizeErrorMessage(error.message)
  console.error(`${color.red}Uncaught Exception:${color.reset}`, sanitizedMessage)
  errorHandler.handleError(error)
})

process.on('unhandledRejection', (reason) => {
  // Skip user cancellation errors
  const reasonStr = String(reason)
  if (reasonStr.includes('Aborted with Ctrl+C') || reasonStr === 'AbortError' ||
      reasonStr.includes('aborted') || reasonStr.includes('cancelled')) {
    return
  }
  const sanitizedReason = sanitizeErrorMessage(reasonStr)
  console.error(`${color.red}Unhandled Rejection:${color.reset}`, sanitizedReason)
  errorHandler.handleError(reason instanceof Error ? reason : new Error(reasonStr))
})
