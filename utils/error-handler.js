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
    await this.logError(error)
    
    if (!this.isTrustedError(error)) {
      console.error(`${color.red}Critical error detected. Application will exit.${color.reset}`)
      process.exit(1)
    }
  }

  async logError(error) {
    const sanitizedMessage = sanitizeErrorMessage(error.message)
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
    return false
  }
}

export const errorHandler = new ErrorHandler()

// Handling unhandled errors
process.on('uncaughtException', (error) => {
  const sanitizedMessage = sanitizeErrorMessage(error.message)
  console.error(`${color.red}Uncaught Exception:${color.reset}`, sanitizedMessage)
  errorHandler.handleError(error)
})

process.on('unhandledRejection', (reason) => {
  const sanitizedReason = sanitizeErrorMessage(String(reason))
  console.error(`${color.red}Unhandled Rejection:${color.reset}`, sanitizedReason)
  errorHandler.handleError(reason instanceof Error ? reason : new Error(String(reason)))
})
