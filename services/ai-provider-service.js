import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { RetryPlugin } from '../plugins/retry-plugin.js'

/**
 * Service for managing AI providers and models
 * Handles provider initialization, switching, and health monitoring
 */
export class AIProviderService {
  constructor(dependencies = {}) {
    this.logger = dependencies.logger || logger
    this.app = dependencies.app
    this.providers = new Map()
    this.currentProvider = null
    this.currentModel = null
    this.currentProviderKey = null
    this.initialized = false
    this.healthCheckInterval = null
    this.stats = {
      providerSwitches: 0,
      modelSwitches: 0,
      healthChecks: 0,
      failedHealthChecks: 0
    }
    
    // Initialize retry plugin with Anthropic-specific settings
    this.retryPlugin = new RetryPlugin({
      maxRetries: 3,
      initialDelay: 1000,
      anthropicRetries: {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 60000,
        backoffMultiplier: 1.5
      }
    })
  }

  async initialize() {
    if (this.initialized) return
    
    try {
      await this.initializeAvailableProviders()
      await this.setDefaultProvider()
      this.startHealthMonitoring()
      this.initialized = true
      this.logger.info('AIProviderService initialized')
    } catch (error) {
      this.logger.error('Failed to initialize AIProviderService:', error)
      throw error
    }
  }

  async initializeAvailableProviders() {
    this.logger.info('Starting Smart Parallel Initialization for AI providers')
    
    // Create parallel initialization promises with 2s timeout per provider
    const providerPromises = Object.entries(API_PROVIDERS)
      .filter(([, config]) => process.env[config.apiKeyEnv])
      .map(async ([providerKey, config]) => {
        try {
          const provider = createProvider(providerKey, config)
          await provider.initializeClient()
          
          // Enhance provider with retry logic
          this.retryPlugin.enhanceInstanceWithRetry(provider)
          
          const models = await Promise.race([
            this.loadModelsForProvider(provider, providerKey),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Model loading timeout (${APP_CONSTANTS.PROVIDER_INIT_TIMEOUT/1000}s)`)), APP_CONSTANTS.PROVIDER_INIT_TIMEOUT)
            )
          ])
          
          return { providerKey, success: true, provider, models, healthy: true }
        } catch (error) {
          return { providerKey, success: false, healthy: false, error: error.message }
        }
      })
    
    if (providerPromises.length === 0) {
      throw new Error('No AI providers available - check your API keys')
    }
    
    // Wait for all providers with Promise.all (but each has its own timeout)
    const results = await Promise.all(providerPromises)
    
    // Process results and register successful providers
    const availableProviders = []
    for (const result of results) {
      if (result.success && result.healthy) {
        this.providers.set(result.providerKey, {
          instance: result.provider,
          config: API_PROVIDERS[result.providerKey],
          models: result.models,
          isHealthy: true,
          lastHealthCheck: Date.now(),
          errorCount: 0
        })
        
        availableProviders.push(result.providerKey)
        this.logger.debug(`Provider ${result.providerKey} initialized with ${result.models.length} models`)
      } else {
        // Store failed providers with null instance for health monitoring fix
        this.providers.set(result.providerKey, {
          instance: null,
          config: API_PROVIDERS[result.providerKey],
          models: [],
          isHealthy: false,
          lastHealthCheck: Date.now(),
          errorCount: 1
        })
        this.logger.warn(`Failed to initialize provider ${result.providerKey}: ${result.error}`)
      }
    }
    
    if (availableProviders.length === 0) {
      throw new Error('No AI providers available - all providers failed to initialize')
    }
    
    this.logger.info(`Smart Parallel Initialization complete: ${availableProviders.length} providers (${availableProviders.join(', ')})`)
  }

  async loadModelsForProvider(provider, providerKey) {
    try {
      const models = await provider.listModels()
      return models || []
    } catch (error) {
      this.logger.warn(`Failed to load models for ${providerKey}:`, error.message)
      
      // Fallback to default models if available (ensure they are strings)
      const fallbackModels = DEFAULT_MODELS[providerKey]
      if (fallbackModels) {
        // Ensure fallback model is a string ID
        const fallbackModelId = typeof fallbackModels.model === 'string' 
          ? fallbackModels.model 
          : fallbackModels.model?.id || fallbackModels.model?.name || 'default'
        return [fallbackModelId]
      }
      return []
    }
  }

  async setDefaultProvider() {
    // Try to find preferred provider from DEFAULT_MODELS (in order: openai, deepseek, anthropic)
    const preferredOrder = ['openai', 'deepseek', 'anthropic']
    
    for (const providerKey of preferredOrder) {
      if (this.providers.has(providerKey) && 
          this.providers.get(providerKey).isHealthy && 
          DEFAULT_MODELS[providerKey]) {
        const modelConfig = DEFAULT_MODELS[providerKey]
        const preferredModel = modelConfig.model
        
        this.logger.info(`Setting default provider: ${providerKey} with model: ${preferredModel}`)
        await this.switchProvider(providerKey, preferredModel)
        return
      }
    }
    
    // Fallback to first HEALTHY provider with its preferred model
    const healthyProviders = Array.from(this.providers.entries())
      .filter(([key, data]) => data.isHealthy)
    
    if (healthyProviders.length === 0) {
      throw new Error('No healthy providers available')
    }
    
    const [firstHealthyProviderKey, firstHealthyProviderData] = healthyProviders[0]
    const fallbackModel = DEFAULT_MODELS[firstHealthyProviderKey]?.model || 'gpt-4o-mini'
    this.logger.warn(`Falling back to healthy provider: ${firstHealthyProviderKey} with model: ${fallbackModel}`)
    await this.switchProvider(firstHealthyProviderKey, fallbackModel)
  }

  async switchProvider(providerKey, model = null) {
    const providerData = this.providers.get(providerKey)
    if (!providerData) {
      throw new Error(`Provider ${providerKey} not available`)
    }

    if (!providerData.isHealthy) {
      throw new Error(`Provider ${providerKey} is currently unhealthy`)
    }

    if (!providerData.instance) {
      throw new Error(`Provider ${providerKey} has null instance (failed initialization)`)
    }

    this.currentProviderKey = providerKey
    this.currentProvider = providerData.instance
    
    // Set model (use preferred model from config, not random first model)
    if (model) {
      this.currentModel = model
    } else {
      // Use preferred model from DEFAULT_MODELS for this provider
      const preferredModel = DEFAULT_MODELS[providerKey]?.model
      if (preferredModel) {
        this.currentModel = preferredModel
      } else if (providerData.models.length > 0) {
        // Fallback: extract ID from first model object  
        const firstModel = providerData.models[0]
        this.currentModel = typeof firstModel === 'string' ? firstModel : firstModel.id || firstModel.name || 'default'
      } else {
        this.currentModel = 'default'
      }
    }

    // Update app state if available
    if (this.app && this.app.aiState) {
      this.app.aiState.provider = this.currentProvider
      this.app.aiState.selectedProviderKey = this.currentProviderKey
      this.app.aiState.model = this.currentModel
      this.app.aiState.models = providerData.models
    }

    this.stats.providerSwitches++
    this.logger.info(`Switched to provider: ${providerKey}, model: ${this.currentModel}`)
    
    return {
      provider: providerKey,
      model: this.currentModel,
      availableModels: providerData.models
    }
  }

  async switchModel(model) {
    if (!this.currentProviderKey) {
      throw new Error('No provider currently active')
    }

    const providerData = this.providers.get(this.currentProviderKey)
    
    // Check if model is available (handle both string and object models)
    const modelExists = providerData.models.some(m => {
      return typeof m === 'string' ? m === model : (m.id === model || m.name === model)
    })
    
    if (!modelExists) {
      throw new Error(`Model ${model} not available for provider ${this.currentProviderKey}`)
    }

    this.currentModel = model
    
    // Update app state
    if (this.app && this.app.aiState) {
      this.app.aiState.model = this.currentModel
    }

    this.stats.modelSwitches++
    this.logger.info(`Switched to model: ${model}`)
    
    return { model: this.currentModel }
  }

  async tryAlternativeProvider() {
    if (this.providers.size <= 1) {
      return false
    }

    const currentKey = this.currentProviderKey
    const availableProviders = Array.from(this.providers.keys())
      .filter(key => key !== currentKey && this.providers.get(key).isHealthy)

    if (availableProviders.length === 0) {
      return false
    }

    try {
      const nextProvider = availableProviders[0]
      await this.switchProvider(nextProvider)
      
      console.log(`${color.yellow}Switched to alternative provider: ${nextProvider}${color.reset}`)
      return true
    } catch (error) {
      this.logger.error('Failed to switch to alternative provider:', error)
      return false
    }
  }

  getCurrentProvider() {
    return {
      key: this.currentProviderKey,
      instance: this.currentProvider,
      model: this.currentModel,
      isHealthy: this.currentProviderKey ? this.providers.get(this.currentProviderKey)?.isHealthy : false
    }
  }

  getAvailableProviders() {
    const providers = []
    for (const [key, data] of this.providers) {
      providers.push({
        key,
        name: data.config.name,
        models: data.models,
        isHealthy: data.isHealthy,
        isCurrent: key === this.currentProviderKey
      })
    }
    return providers
  }

  async createChatCompletion(messages, options = {}) {
    if (!this.currentProvider) {
      throw new Error('No provider currently active')
    }

    try {
      return await this.currentProvider.createChatCompletion(
        this.currentModel,
        messages,
        options
      )
    } catch (error) {
      // Mark provider as potentially unhealthy after error
      const providerData = this.providers.get(this.currentProviderKey)
      if (providerData) {
        providerData.errorCount++
        if (providerData.errorCount > 3) {
          providerData.isHealthy = false
        }
      }
      
      throw error
    }
  }

  startHealthMonitoring() {
    if (this.healthCheckInterval) return
    
    // Check provider health every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks()
    }, 5 * 60 * 1000)
  }

  async performHealthChecks() {
    this.stats.healthChecks++
    
    for (const [key, providerData] of this.providers) {
      try {
        // Skip health check if provider instance is null (failed initialization)
        if (!providerData.instance) {
          providerData.isHealthy = false
          this.logger.debug(`Provider ${key} skipped health check - null instance`)
          continue
        }
        
        // Simple health check - try to list models
        await providerData.instance.listModels()
        providerData.isHealthy = true
        providerData.errorCount = 0
        providerData.lastHealthCheck = Date.now()
      } catch (error) {
        providerData.errorCount++
        if (providerData.errorCount > 2) {
          providerData.isHealthy = false
          this.stats.failedHealthChecks++
          this.logger.warn(`Provider ${key} marked as unhealthy: ${error.message}`)
        }
      }
    }
  }

  getProviderStats() {
    return {
      ...this.stats,
      totalProviders: this.providers.size,
      healthyProviders: Array.from(this.providers.values()).filter(p => p.isHealthy).length,
      currentProvider: this.currentProviderKey,
      currentModel: this.currentModel
    }
  }

  getHealthStatus() {
    const healthyProviders = Array.from(this.providers.values()).filter(p => p.isHealthy).length
    
    return {
      initialized: this.initialized,
      totalProviders: this.providers.size,
      healthyProviders,
      hasCurrentProvider: !!this.currentProvider,
      currentProviderHealthy: this.currentProviderKey ? 
        this.providers.get(this.currentProviderKey)?.isHealthy : false,
      isHealthy: this.initialized && healthyProviders > 0 && !!this.currentProvider
    }
  }


  dispose() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    
    this.providers.clear()
    this.currentProvider = null
    this.currentProviderKey = null
    this.currentModel = null
    this.initialized = false
    this.logger.debug('AIProviderService disposed')
  }
}