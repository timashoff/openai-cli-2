import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

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
    const availableProviders = []
    
    for (const [providerKey, config] of Object.entries(API_PROVIDERS)) {
      if (process.env[config.apiKeyEnv]) {
        try {
          const provider = createProvider(providerKey, config)
          await provider.initializeClient()
          
          // Load models for this provider
          const models = await this.loadModelsForProvider(provider, providerKey)
          
          this.providers.set(providerKey, {
            instance: provider,
            config,
            models,
            isHealthy: true,
            lastHealthCheck: Date.now(),
            errorCount: 0
          })
          
          availableProviders.push(providerKey)
          this.logger.debug(`Provider ${providerKey} initialized with ${models.length} models`)
        } catch (error) {
          this.logger.warn(`Failed to initialize provider ${providerKey}:`, error.message)
        }
      } else {
        this.logger.debug(`Provider ${providerKey} skipped - no API key`)
      }
    }
    
    if (availableProviders.length === 0) {
      throw new Error('No AI providers available - check your API keys')
    }
    
    this.logger.info(`Initialized ${availableProviders.length} providers: ${availableProviders.join(', ')}`)
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
      if (this.providers.has(providerKey) && DEFAULT_MODELS[providerKey]) {
        const modelConfig = DEFAULT_MODELS[providerKey]
        const preferredModel = modelConfig.model
        
        this.logger.info(`Setting default provider: ${providerKey} with model: ${preferredModel}`)
        await this.switchProvider(providerKey, preferredModel)
        return
      }
    }
    
    // Fallback to first available provider with its preferred model
    const firstProvider = this.providers.keys().next().value
    if (firstProvider) {
      const fallbackModel = DEFAULT_MODELS[firstProvider]?.model || 'gpt-4o-mini'
      this.logger.warn(`Falling back to provider: ${firstProvider} with model: ${fallbackModel}`)
      await this.switchProvider(firstProvider, fallbackModel)
    }
  }

  async switchProvider(providerKey, model = null) {
    const providerData = this.providers.get(providerKey)
    if (!providerData) {
      throw new Error(`Provider ${providerKey} not available`)
    }

    if (!providerData.isHealthy) {
      throw new Error(`Provider ${providerKey} is currently unhealthy`)
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