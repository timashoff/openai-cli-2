import { APP_CONSTANTS } from '../config/constants.js'
import { createBaseError } from '../core/error-system/index.js'

/**
 * Validates API key format



 */
export function validateApiKey(apiKey, provider) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw createBaseError(`Invalid API key for ${provider}`, true, 401)
  }

  let regex
  switch (provider.toLowerCase()) {
    case 'openai':
      regex = APP_CONSTANTS.REGEX.API_KEY_OPENAI
      break
    case 'deepseek':
      regex = APP_CONSTANTS.REGEX.API_KEY_DEEPSEEK
      break
    case 'anthropic':
      regex = APP_CONSTANTS.REGEX.API_KEY_ANTHROPIC
      break
    default:
      // Generic validation for unknown providers
      regex = /^[a-zA-Z0-9\-_]{20,}$/
  }

  if (!regex.test(apiKey)) {
    throw createBaseError(`Invalid API key format for ${provider}`, true, 401)
  }

  return true
}


/**
 * Sanitizes error messages to prevent key exposure


 */
export function sanitizeErrorMessage(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') {
    return 'Unknown error occurred'
  }

  // Remove potential API keys from error messages
  let sanitized = errorMessage
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY_MASKED]')
    .replace(/sk-ant-api03-[a-zA-Z0-9\-_]{95}/g, '[API_KEY_MASKED]')
    .replace(/Bearer\s+[a-zA-Z0-9\-_]{20,}/gi, 'Bearer [MASKED]')

  // Remove file paths that might contain sensitive info
  sanitized = sanitized.replace(/\/[^\s]+/g, '[PATH_MASKED]')

  // Remove IP addresses
  sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_MASKED]')

  return sanitized
}



/**
 * Rate limiting utility with exponential backoff
 */
export class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 60000, backoffMultiplier = 2) {
    this.maxRequests = maxRequests
    this.timeWindow = timeWindow
    this.backoffMultiplier = backoffMultiplier
    this.requests = []
    this.violations = 0
  }

  canMakeRequest() {
    const now = Date.now()
    // Remove old requests outside time window
    this.requests = this.requests.filter(time => now - time < this.timeWindow)
    
    return this.requests.length < this.maxRequests
  }

  recordRequest() {
    if (!this.canMakeRequest()) {
      this.violations++
      const backoffTime = this.getBackoffTime()
      throw createBaseError(`Rate limit exceeded. Please wait ${Math.ceil(backoffTime / 1000)} seconds before making another request.`, true, 429)
    }
    
    this.requests.push(Date.now())
    this.violations = 0 // Reset violations on successful request
  }

  getWaitTime() {
    if (this.requests.length === 0) return 0
    
    const oldestRequest = Math.min(...this.requests)
    const waitTime = this.timeWindow - (Date.now() - oldestRequest)
    
    return Math.max(0, waitTime)
  }

  getBackoffTime() {
    return Math.min(this.timeWindow * Math.pow(this.backoffMultiplier, this.violations), 300000) // Max 5 minutes
  }

  reset() {
    this.requests = []
    this.violations = 0
  }
}

/**
 * Content Security Policy checker
 */
export class CSPChecker {
  constructor() {
    this.allowedDomains = [
      'api.openai.com',
      'api.anthropic.com',
      'api.deepseek.com'
    ]
  }

  validateUrl(url) {
    try {
      const parsedUrl = new URL(url)
      
      // Check protocol
      if (!['https:'].includes(parsedUrl.protocol)) {
        throw createBaseError('Only HTTPS URLs are allowed', true, 400)
      }
      
      // Check domain
      if (!this.allowedDomains.includes(parsedUrl.hostname)) {
        throw createBaseError(`Domain ${parsedUrl.hostname} is not allowed`, true, 403)
      }
      
      return true
    } catch (error) {
      if (error instanceof BaseError) {
        throw error
      }
      throw createBaseError('Invalid URL format', true, 400)
    }
  }

}

