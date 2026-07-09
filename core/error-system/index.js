import { logger } from '../../utils/logger.js'
import { ANSI } from '../../config/ansi.js'
import { PROVIDERS } from '../../config/providers.js'

// Unified error system - Single Source of Truth for functional, Zero-Trust error handling.

// Create a real Error carrying app metadata (instanceof Error stays true, stack is real).
export const createBaseError = (
  message,
  isUserInputError = false,
  statusCode = 500,
  cause = null,
) => {
  const error = new Error(message)
  error.name = 'AppError'
  error.isUserInputError = isUserInputError
  error.isOperational = true
  error.statusCode = statusCode
  if (cause) error.cause = cause
  return error
}

// Re-login instruction — shown ONLY when the gateway itself rejected the session
// (isGatewaySessionError), never for an upstream provider 401 (a bad gateway key/
// quota), since re-login would not help there. isUserInputError=true → prints plainly.
export const AUTH_EXPIRED_MESSAGE = 'Session expired or invalid. Run: ai login'
export const isGatewaySessionError = (error) =>
  Boolean(error) && error.gatewaySession === true

// The single cancellation predicate - replaces scattered 'AbortError' string checks.
export const isCancellation = (error) => {
  if (!error) return false
  const name = error.name || ''
  const message = error.message || ''
  return (
    error.type === 'CANCELLATION' ||
    name === 'AbortError' ||
    name === 'CancellationError' ||
    message === 'AbortError' ||
    message.toLowerCase().includes('abort') ||
    message.toLowerCase().includes('cancel')
  )
}

// Zero-Trust sanitization without regex: redact the app's own known API keys
// (exact values from env) plus any key-shaped tokens, so secrets never reach a user or log.
const knownSecrets = () => {
  const secrets = []
  for (const config of Object.values(PROVIDERS)) {
    const value = process.env[config.apiKeyEnv]
    if (value && value.length >= 8) secrets.push(value)
  }
  return secrets
}

const KEY_PREFIXES = ['sk-', 'pk-']
const looksLikeKey = (word) =>
  word.length >= 20 && KEY_PREFIXES.some((prefix) => word.startsWith(prefix))

export const sanitizeMessage = (message) => {
  if (!message || typeof message !== 'string') {
    return message || 'Unknown error'
  }
  let out = message
  for (const secret of knownSecrets()) {
    out = out.split(secret).join('[REDACTED-KEY]')
  }
  return out
    .split(' ')
    .map((word) => (looksLikeKey(word) ? '[REDACTED-KEY]' : word))
    .join(' ')
}

const NETWORK_CODES = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']
const NETWORK_HINTS = [
  'fetch failed',
  'network',
  'timeout',
  'terminated',
  'Failed to create chat completion',
  'Rate limit',
  'Authentication',
]

const isNetworkish = (error) => {
  if (NETWORK_CODES.includes(error.code)) return true
  const message = error.message || ''
  return NETWORK_HINTS.some((hint) => message.includes(hint))
}

// Classify a raw error into a safe user message + log level (dictionary flow, no switch).
const describe = (error) => {
  if (isCancellation(error)) {
    return { userMessage: null, shouldDisplay: false, logLevel: 'debug' }
  }
  if (error.isUserInputError) {
    // Displayed to the user (shouldDisplay) → log at debug so it is not ALSO
    // printed to the console at warn (that produced the duplicate error line).
    return { userMessage: sanitizeMessage(error.message), shouldDisplay: true, logLevel: 'debug' }
  }
  const prefix = isNetworkish(error) ? '' : 'Error: '
  return {
    userMessage: `${prefix}${sanitizeMessage(error.message)}`,
    shouldDisplay: true,
    logLevel: 'error',
  }
}

const LOG_BY_LEVEL = {
  debug: (message) => logger.debug(message),
  warn: (message) => logger.warn(message),
  error: (message) => logger.error(message),
}

// Fire-and-forget: logger is async and self-guards its writes; a CLI tolerates this.
const writeLog = (processed, context) => {
  const where = context.component ? ` [${context.component}]` : ''
  const name = processed.originalError.name || 'Error'
  const message = `${name}${where}: ${sanitizeMessage(processed.originalError.message)}`
  const log = LOG_BY_LEVEL[processed.logLevel] || LOG_BY_LEVEL.error
  log(message)
}

// Classify + log (except silent cancellations). Returns the processed error.
export const processError = (error, context = {}) => {
  const processed = { originalError: error, context, ...describe(error) }
  if (!isCancellation(error)) {
    writeLog(processed, context)
  }
  return processed
}

export const displayError = (processed) => {
  if (!processed.shouldDisplay || !processed.userMessage) return
  if (processed.originalError && processed.originalError.isUserInputError) {
    console.log(processed.userMessage)
    return
  }
  console.log(`${ANSI.COLORS.RED}${processed.userMessage}${ANSI.COLORS.RESET}`)
}

// Handle a caught error: classify, log, display. Never exits - callers decide that.
export const handleError = (error, context = {}) => {
  const processed = processError(error, context)
  displayError(processed)
  return processed
}

export const errorHandler = {
  processError,
  handleError,
  displayError,
}

// Global safety net for truly unhandled errors, registered once at import.
const registerGlobalHandlers = () => {
  const onFatal = (label, error) => {
    if (isCancellation(error)) return
    console.error(
      `${ANSI.COLORS.RED}${label}:${ANSI.COLORS.RESET}`,
      sanitizeMessage(error.message),
    )
    process.exit(1)
  }

  process.on('uncaughtException', (error) => onFatal('Uncaught Exception', error))
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    onFatal('Unhandled Rejection', error)
  })
}

registerGlobalHandlers()
