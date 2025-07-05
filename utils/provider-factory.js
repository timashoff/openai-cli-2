import { AppError } from './error-handler.js'
import { logger } from './logger.js'
import { validateString, validateObject } from './validation.js'
import { RateLimiter, CSPChecker } from './security.js'

/**
 * Abstract base provider class
 */
export class BaseProvider {
  constructor(config) {
    this.config = config
    this.rateLimiter = new RateLimiter(
      config.rateLimitRequests || 10,
      config.rateLimitWindow || 60000
    )
    this.cspChecker = new CSPChecker()
    this.stats = {
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      lastRequest: null
    }
  }

  /**
   * Validate provider configuration
   */
  validateConfig() {
    const required = ['name', 'baseURL', 'apiKeyEnv']
    for (const field of required) {
      if (!this.config[field]) {
        throw new AppError(`Provider config missing required field: ${field}`, true, 400)
      }
    }
  }

  /**
   * Get API key from environment
   */
  getApiKey() {
    const apiKey = process.env[this.config.apiKeyEnv]
    if (!apiKey) {
      throw new AppError(`API key not found in environment variable: ${this.config.apiKeyEnv}`, true, 401)
    }
    return apiKey
  }

  /**
   * Record request statistics
   */
  recordRequest(responseTime, error = null) {
    this.stats.requests++
    this.stats.totalResponseTime += responseTime
    this.stats.lastRequest = Date.now()
    
    if (error) {
      this.stats.errors++
    }
  }

  /**
   * Get provider statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageResponseTime: this.stats.requests > 0 
        ? this.stats.totalResponseTime / this.stats.requests 
        : 0,
      errorRate: this.stats.requests > 0 
        ? (this.stats.errors / this.stats.requests) * 100 
        : 0
    }
  }

  /**
   * Abstract methods to be implemented by subclasses
   */
  async listModels() {
    throw new Error('listModels() must be implemented by provider subclass')
  }

  async createChatCompletion(model, messages, options = {}) {
    throw new Error('createChatCompletion() must be implemented by provider subclass')
  }

  async validateModel(modelId) {
    throw new Error('validateModel() must be implemented by provider subclass')
  }
}

/**
 * OpenAI-compatible provider
 */
export class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super(config)
    this.validateConfig()
    this.initializeClient()
  }

  initializeClient() {
    try {
      const { OpenAI } = await import('openai')
      this.client = new OpenAI({
        baseURL: this.config.baseURL,
        apiKey: this.getApiKey(),
        timeout: this.config.timeout || 100000
      })
    } catch (error) {
      throw new AppError(`Failed to initialize OpenAI client: ${error.message}`, true, 500)
    }
  }

  async listModels() {
    this.rateLimiter.recordRequest()
    const startTime = Date.now()
    
    try {
      const response = await this.client.models.list()
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime)
      
      return response.data.sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) {
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime, error)
      throw new AppError(`Failed to list models: ${error.message}`, true, 500)
    }
  }

  async createChatCompletion(model, messages, options = {}) {
    this.rateLimiter.recordRequest()
    const startTime = Date.now()
    
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        stream: options.stream || true,
        ...options
      })
      
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime)
      
      return response
    } catch (error) {
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime, error)
      throw new AppError(`Failed to create chat completion: ${error.message}`, true, 500)
    }
  }

  async validateModel(modelId) {
    try {
      const models = await this.listModels()
      return models.some(model => model.id === modelId)
    } catch (error) {
      logger.warn(`Failed to validate model ${modelId}: ${error.message}`)
      return false
    }
  }
}

/**
 * Anthropic provider
 */
export class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super(config)
    this.validateConfig()
    this.apiKey = this.getApiKey()
  }

  async makeRequest(url, options = {}) {
    this.cspChecker.validateUrl(url)
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        ...options.headers
      }
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      throw new Error(error.error?.message || 'API request failed')
    }
    
    return response
  }

  async listModels() {
    this.rateLimiter.recordRequest()
    const startTime = Date.now()
    
    try {
      const response = await this.makeRequest('https://api.anthropic.com/v1/models')
      const data = await response.json()
      
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime)
      
      return data.data.sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) {
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime, error)
      throw new AppError(`Failed to list Anthropic models: ${error.message}`, true, 500)
    }
  }

  async createChatCompletion(model, messages, options = {}) {
    this.rateLimiter.recordRequest()
    const startTime = Date.now()
    
    try {
      const response = await this.makeRequest('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages,
          stream: options.stream || true,
          max_tokens: options.max_tokens || 4096,
          ...options
        })
      })
      
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime)
      
      return response.body
    } catch (error) {
      const responseTime = Date.now() - startTime
      this.recordRequest(responseTime, error)
      throw new AppError(`Failed to create Anthropic chat completion: ${error.message}`, true, 500)
    }
  }

  async validateModel(modelId) {
    try {
      const models = await this.listModels()
      return models.some(model => model.id === modelId)
    } catch (error) {
      logger.warn(`Failed to validate Anthropic model ${modelId}: ${error.message}`)
      return false
    }
  }
}

/**
 * Provider factory with registry
 */
export class ProviderFactory {
  constructor() {
    this.providers = new Map()
    this.instances = new Map()
    this.registerBuiltinProviders()
  }

  /**
   * Register built-in providers
   */
  registerBuiltinProviders() {
    this.registerProvider('openai', OpenAIProvider)
    this.registerProvider('deepseek', OpenAIProvider)
    this.registerProvider('anthropic', AnthropicProvider)
  }

  /**
   * Register a provider class
   */
  registerProvider(type, ProviderClass) {
    if (typeof ProviderClass !== 'function') {
      throw new AppError('Provider must be a constructor function', true, 400)
    }
    
    this.providers.set(type, ProviderClass)
    logger.debug(`Provider type ${type} registered`)
  }

  /**
   * Create provider instance
   */
  createProvider(type, config) {
    const ProviderClass = this.providers.get(type)
    if (!ProviderClass) {
      throw new AppError(`Unknown provider type: ${type}`, true, 404)
    }
    
    validateObject(config, 'provider config')
    
    try {
      const instance = new ProviderClass(config)
      const instanceId = `${type}:${config.name || 'default'}`
      this.instances.set(instanceId, instance)
      
      logger.info(`Provider instance created: ${instanceId}`)
      return instance
    } catch (error) {
      throw new AppError(`Failed to create provider ${type}: ${error.message}`, true, 500)
    }
  }

  /**
   * Get provider instance
   */
  getProvider(instanceId) {
    return this.instances.get(instanceId)
  }

  /**
   * Get all provider instances
   */
  getAllProviders() {
    return Array.from(this.instances.values())
  }

  /**
   * Get provider statistics
   */
  getProviderStats() {
    const stats = {}
    
    for (const [id, provider] of this.instances) {
      stats[id] = provider.getStats()
    }
    
    return stats
  }

  /**
   * Remove provider instance
   */
  removeProvider(instanceId) {
    const removed = this.instances.delete(instanceId)
    if (removed) {
      logger.info(`Provider instance removed: ${instanceId}`)
    }
    return removed
  }

  /**
   * Get available provider types
   */
  getAvailableTypes() {
    return Array.from(this.providers.keys())
  }

  /**
   * Validate provider configuration
   */
  validateProviderConfig(type, config) {
    const ProviderClass = this.providers.get(type)
    if (!ProviderClass) {
      throw new AppError(`Unknown provider type: ${type}`, true, 404)
    }
    
    // Create temporary instance for validation
    try {
      const tempInstance = new ProviderClass(config)
      tempInstance.validateConfig()
      return true
    } catch (error) {
      throw new AppError(`Provider config validation failed: ${error.message}`, true, 400)
    }
  }
}

// Export singleton instance
export const providerFactory = new ProviderFactory()