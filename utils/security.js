import { APP_CONSTANTS } from '../config/constants.js'
import { AppError } from './error-handler.js'

/**
 * Validates API key format
 * @param {string} apiKey - API key to validate
 * @param {string} provider - provider name
 * @returns {boolean} true if valid
 */
export function validateApiKey(apiKey, provider) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError(`Invalid API key for ${provider}`, true, 401)
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
    throw new AppError(`Invalid API key format for ${provider}`, true, 401)
  }

  return true
}

/**
 * Masks API key for logging
 * @param {string} apiKey - API key to mask
 * @returns {string} masked API key
 */
export function maskApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return '[INVALID_KEY]'
  }

  if (apiKey.length <= 8) {
    return '[MASKED]'
  }

  const start = apiKey.substring(0, 4)
  const end = apiKey.substring(apiKey.length - 4)
  const masked = '*'.repeat(apiKey.length - 8)
  
  return `${start}${masked}${end}`
}

/**
 * Sanitizes error messages to prevent key exposure
 * @param {string} errorMessage - original error message
 * @returns {string} sanitized error message
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
 * Securely clears variable from memory
 * @param {object} obj - object containing sensitive data
 * @param {string} key - key to clear
 */
export function secureDelete(obj, key) {
  if (obj && typeof obj === 'object' && key in obj) {
    // Overwrite with random data before deletion
    if (typeof obj[key] === 'string') {
      obj[key] = Math.random().toString(36).repeat(obj[key].length)
    }
    delete obj[key]
  }
}

/**
 * Creates a secure headers object for API requests
 * @param {string} apiKey - API key
 * @param {string} provider - provider name
 * @returns {object} headers object
 */
export function createSecureHeaders(apiKey, provider) {
  validateApiKey(apiKey, provider)

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'OpenAI-CLI/2.5.1'
  }

  switch (provider.toLowerCase()) {
    case 'openai':
    case 'deepseek':
      headers['Authorization'] = `Bearer ${apiKey}`
      break
    case 'anthropic':
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
      break
    default:
      headers['Authorization'] = `Bearer ${apiKey}`
  }

  return headers
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
      throw new AppError(`Rate limit exceeded. Please wait ${Math.ceil(backoffTime / 1000)} seconds before making another request.`, true, 429)
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
        throw new AppError('Only HTTPS URLs are allowed', true, 400)
      }
      
      // Check domain
      if (!this.allowedDomains.includes(parsedUrl.hostname)) {
        throw new AppError(`Domain ${parsedUrl.hostname} is not allowed`, true, 403)
      }
      
      return true
    } catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      throw new AppError('Invalid URL format', true, 400)
    }
  }

  addAllowedDomain(domain) {
    if (!this.allowedDomains.includes(domain)) {
      this.allowedDomains.push(domain)
    }
  }
}

/**
 * Input sanitization with additional security measures
 */
export function sanitizeInput(input, options = {}) {
  const {
    allowHTML = false,
    maxLength = 10000,
    stripScripts = true,
    removeControlChars = true
  } = options

  if (typeof input !== 'string') {
    return ''
  }

  let sanitized = input

  // Remove control characters
  if (removeControlChars) {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '')
  }

  // Remove script tags and javascript: URLs
  if (stripScripts) {
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    sanitized = sanitized.replace(/javascript:/gi, '')
    sanitized = sanitized.replace(/on\w+\s*=/gi, '')
  }

  // Remove HTML tags if not allowed
  if (!allowHTML) {
    sanitized = sanitized.replace(/<[^>]*>/g, '')
  }

  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }

  return sanitized.trim()
}