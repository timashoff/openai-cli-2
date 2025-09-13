import { createBaseError } from '../../core/error-system/index.js'
import { RateLimiter, CSPChecker } from '../security.js'
import { PROVIDER_DEFAULTS } from '../../config/providers.js'

export const createBaseProvider = (config) => {
  const state = {
    config,
    rateLimiter: new RateLimiter(
      config.rateLimitRequests || PROVIDER_DEFAULTS.RATE_LIMIT_REQUESTS,
      config.rateLimitWindow || PROVIDER_DEFAULTS.RATE_LIMIT_WINDOW
    ),
    cspChecker: new CSPChecker(),
    stats: {
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      lastRequest: null
    }
  }

  const validateConfig = () => {
    for (const field of PROVIDER_DEFAULTS.REQUIRED_FIELDS) {
      if (!state.config[field]) {
        throw createBaseError(`Provider config missing required field: ${field}`, true, 400)
      }
    }
  }

  const getApiKey = () => {
    const apiKey = process.env[state.config.apiKeyEnv]
    if (!apiKey) {
      throw createBaseError(`API key not found in environment variable: ${state.config.apiKeyEnv}`, true, 401)
    }
    return apiKey
  }

  const recordRequest = (responseTime, error = null) => {
    state.stats.requests++
    state.stats.totalResponseTime += responseTime
    state.stats.lastRequest = Date.now()

    if (error) {
      state.stats.errors++
    }
  }

  const getStats = () => {
    return {
      ...state.stats,
      averageResponseTime: state.stats.requests > 0
        ? state.stats.totalResponseTime / state.stats.requests
        : 0,
      errorRate: state.stats.requests > 0
        ? (state.stats.errors / state.stats.requests) * 100
        : 0
    }
  }

  const listModels = async () => {
    throw new Error('listModels() must be implemented by provider subclass')
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    throw new Error('createChatCompletion() must be implemented by provider subclass')
  }

  const validateModel = async (modelId) => {
    throw new Error('validateModel() must be implemented by provider subclass')
  }

  return {
    config: state.config,
    rateLimiter: state.rateLimiter,
    cspChecker: state.cspChecker,
    stats: state.stats,
    validateConfig,
    getApiKey,
    recordRequest,
    getStats,
    listModels,
    createChatCompletion,
    validateModel
  }
}