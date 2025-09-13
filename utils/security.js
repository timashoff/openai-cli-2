import { createBaseError } from '../core/error-system/index.js'

// Security constants
const SECURITY_CONSTANTS = {
  API_KEY_MIN_LENGTH: 20,
  RATE_LIMIT_MAX_BACKOFF: 300000, // 5 minutes
  OPENAI_KEY_LENGTH: 51,
  DEEPSEEK_KEY_LENGTH: 51,
  ANTHROPIC_KEY_LENGTH: 108
}

// API key validators dictionary - functional approach
const API_KEY_VALIDATORS = {
  openai: (key) => {
    return key.startsWith('sk-') && key.length >= SECURITY_CONSTANTS.OPENAI_KEY_LENGTH
  },
  
  deepseek: (key) => {
    return key.startsWith('sk-') && key.length >= SECURITY_CONSTANTS.DEEPSEEK_KEY_LENGTH
  },
  
  anthropic: (key) => {
    return key.startsWith('sk-ant-api03-') && key.length >= SECURITY_CONSTANTS.ANTHROPIC_KEY_LENGTH
  },
  
  default: (key) => {
    return key.length >= SECURITY_CONSTANTS.API_KEY_MIN_LENGTH && /^[a-zA-Z0-9\-_]+$/.test(key)
  }
}

export function validateApiKey(apiKey, provider) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw createBaseError(`Invalid API key for ${provider}`, true, 401)
  }

  const validator = API_KEY_VALIDATORS[provider.toLowerCase()] || API_KEY_VALIDATORS.default
  
  if (!validator(apiKey)) {
    throw createBaseError(`Invalid API key format for ${provider}`, true, 401)
  }

  return true
}

export function createRateLimiter(maxRequests = 10, timeWindow = 60000, backoffMultiplier = 2) {
  const state = {
    requests: [],
    violations: 0
  }

  const canMakeRequest = () => {
    const now = Date.now()
    state.requests = state.requests.filter(time => now - time < timeWindow)
    return state.requests.length < maxRequests
  }

  const recordRequest = () => {
    if (!canMakeRequest()) {
      state.violations++
      const backoffTime = getBackoffTime()
      throw createBaseError(`Rate limit exceeded. Please wait ${Math.ceil(backoffTime / 1000)} seconds before making another request.`, true, 429)
    }
    
    state.requests.push(Date.now())
    state.violations = 0
  }

  const getWaitTime = () => {
    if (state.requests.length === 0) return 0
    
    const oldestRequest = Math.min(...state.requests)
    const waitTime = timeWindow - (Date.now() - oldestRequest)
    
    return Math.max(0, waitTime)
  }

  const getBackoffTime = () => {
    return Math.min(timeWindow * Math.pow(backoffMultiplier, state.violations), SECURITY_CONSTANTS.RATE_LIMIT_MAX_BACKOFF)
  }

  const reset = () => {
    state.requests = []
    state.violations = 0
  }

  return {
    canMakeRequest,
    recordRequest,
    getWaitTime,
    getBackoffTime,
    reset
  }
}


