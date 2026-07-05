// Unified Error System - Single Source of Truth for functional error handling.
// Central re-export point for error types and the error handler.

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
  createFromGeneric,
} from './ErrorTypes.js'

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
  sanitizeMessage,
} from './ErrorHandler.js'
