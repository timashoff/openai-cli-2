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
      this.logger.debug('AIProviderService initialized')
    } catch (error) {
      this.logger.error('Failed to initialize AIProviderService:', error)
      throw error
    }
  }

  async initializeAvailableProviders() {
    this.logger.debug('Starting Smart Parallel Initialization for AI providers')
    
    // Get available provider keys (with API keys set)
    const availableProviderKeys = Object.entries(API_PROVIDERS)
      .filter(([, config]) => process.env[config.apiKeyEnv])
      .map(([key]) => key)
    
    if (availableProviderKeys.length === 0) {
      throw new Error('No AI providers available - check your API keys')
    }
    
    // Determine default provider (preference order: openai, anthropic, deepseek)
    const preferredOrder = ['openai', 'anthropic', 'deepseek']
    const defaultProviderKey = preferredOrder.find(key => availableProviderKeys.includes(key)) || availableProviderKeys[0]
    
    // Initialize ONLY the default provider immediately
    try {
      const config = API_PROVIDERS[defaultProviderKey]
      const provider = createProvider(defaultProviderKey, config)
      await provider.initializeClient()
      
      // Enhance provider with retry logic
      this.retryPlugin.enhanceInstanceWithRetry(provider)
      
      // Load models with shorter timeout for startup
      const models = await Promise.race([
        this.loadModelsForProvider(provider, defaultProviderKey),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Model loading timeout (5s)`)), 5000)
        )
      ])
      
      // Store successful default provider
      this.providers.set(defaultProviderKey, {
        instance: provider,
        config,
        models,
        isHealthy: true,
        lastHealthCheck: Date.now(),
        errorCount: 0
      })
      
      this.logger.debug(`Default provider ${defaultProviderKey} initialized with ${models.length} models`)
      
      // Store other providers as lazy-loadable (not yet initialized)
      for (const providerKey of availableProviderKeys) {
        if (providerKey !== defaultProviderKey) {
          this.providers.set(providerKey, {
            instance: null, // Will be loaded on demand
            config: API_PROVIDERS[providerKey],
            models: [],
            isHealthy: null, // Unknown until loaded
            lastHealthCheck: null,
            errorCount: 0,
            isLazyLoading: true
          })
        }
      }
      
      this.logger.debug(`Smart Parallel Initialization complete: 1 providers (${defaultProviderKey})`)
      
      // Default provider initialized successfully
      const defaultModel = DEFAULT_MODELS[defaultProviderKey]?.model || models[0]?.id || 'unknown'
      this.logger.debug(`Default provider ready: ${API_PROVIDERS[defaultProviderKey].name} with ${defaultModel}`)
      
    } catch (error) {
      this.logger.debug(`Default provider ${defaultProviderKey} failed: ${error.message}`)
      
      // Try fallback providers
      const remainingProviders = preferredOrder.filter(key => 
        key !== defaultProviderKey && availableProviderKeys.includes(key)
      )
      
      let fallbackSuccess = false
      for (const fallbackProviderKey of remainingProviders) {
        try {
          this.logger.debug(`Trying fallback provider: ${fallbackProviderKey}`)
          
          const config = API_PROVIDERS[fallbackProviderKey]
          const provider = createProvider(fallbackProviderKey, config)
          await provider.initializeClient()
          
          this.retryPlugin.enhanceInstanceWithRetry(provider)
          
          const models = await Promise.race([
            this.loadModelsForProvider(provider, fallbackProviderKey),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Model loading timeout (5s)`)), 5000)
            )
          ])
          
          this.providers.set(fallbackProviderKey, {
            instance: provider,
            config,
            models,
            isHealthy: true,
            lastHealthCheck: Date.now(),
            errorCount: 0
          })
          
          this.logger.debug(`Fallback provider ${fallbackProviderKey} initialized, testing connectivity...`)
          
          // Test real connectivity with minimal request
          try {
            const testModel = models[0]?.id || DEFAULT_MODELS[fallbackProviderKey]?.model || 'test'
            await provider.createChatCompletion(
              testModel,
              [{ role: 'user', content: 'hi' }], 
              { stream: false, max_tokens: 1 }
            )
            this.logger.debug(`Fallback provider ${fallbackProviderKey} connectivity confirmed`)
            
            // Fallback provider initialized successfully
            this.logger.debug(`Fallback provider ready: ${API_PROVIDERS[fallbackProviderKey].name} with ${testModel}`)
            
            fallbackSuccess = true
          } catch (connectivityError) {
            this.logger.debug(`Fallback provider ${fallbackProviderKey} connectivity test failed: ${connectivityError.message}`)
            // Remove the failed provider from our providers map
            this.providers.delete(fallbackProviderKey)
            continue // Try next provider
          }
          
          // Store other providers as lazy-loadable (excluding the working fallback)
          for (const providerKey of availableProviderKeys) {
            if (providerKey !== fallbackProviderKey && providerKey !== defaultProviderKey) {
              this.providers.set(providerKey, {
                instance: null,
                config: API_PROVIDERS[providerKey],
                models: [],
                isHealthy: null,
                lastHealthCheck: null,
                errorCount: 0,
                isLazyLoading: true
              })
            }
          }
          
          break
          
        } catch (fallbackError) {
          this.logger.debug(`Fallback provider ${fallbackProviderKey} also failed: ${fallbackError.message}`)
          continue
        }
      }
      
      if (!fallbackSuccess) {
        throw new Error(`All available providers failed to initialize. Last error: ${error.message}`)
      }
    }
  }

  async loadModelsForProvider(provider, providerKey) {
    try {
      const models = await provider.listModels()
      return models || []
    } catch (error) {
      this.logger.debug(`Failed to load models for ${providerKey}:`, error.message)
      
      // Fallback to default models if available
      const fallbackModels = DEFAULT_MODELS[providerKey]
      if (fallbackModels) {
        // Ensure fallback model is in consistent format (array of objects with id)
        const fallbackModelId = typeof fallbackModels.model === 'string' 
          ? fallbackModels.model 
          : fallbackModels.model?.id || fallbackModels.model?.name || 'default'
        return [{ id: fallbackModelId }]
      }
      return []
    }
  }

  /**
   * Lazy load a provider on demand
   * @param {string} providerKey - Provider key to load
   * @returns {Promise<Object>} Loaded provider info
   */
  async lazyLoadProvider(providerKey) {
    const providerInfo = this.providers.get(providerKey)
    
    // If provider is already loaded, return it
    if (providerInfo && providerInfo.instance && !providerInfo.isLazyLoading) {
      return providerInfo
    }
    
    // If provider doesn't exist or has no config, cannot load
    if (!providerInfo || !providerInfo.config) {
      throw new Error(`Provider ${providerKey} not available`)
    }
    
    this.logger.debug(`Lazy loading provider: ${providerKey}`)
    
    try {
      const provider = createProvider(providerKey, providerInfo.config)
      await provider.initializeClient()
      
      // Enhance provider with retry logic
      this.retryPlugin.enhanceInstanceWithRetry(provider)
      
      // Load models with timeout
      const models = await Promise.race([
        this.loadModelsForProvider(provider, providerKey),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Model loading timeout (10s)`)), 10000)
        )
      ])
      
      // Update provider info
      const updatedProviderInfo = {
        instance: provider,
        config: providerInfo.config,
        models,
        isHealthy: true,
        lastHealthCheck: Date.now(),
        errorCount: 0,
        isLazyLoading: false
      }
      
      this.providers.set(providerKey, updatedProviderInfo)
      this.logger.debug(`Provider ${providerKey} lazy loaded with ${models.length} models`)
      
      return updatedProviderInfo
      
    } catch (error) {
      this.logger.debug(`Failed to lazy load provider ${providerKey}:`, error.message)
      
      // Update provider as failed
      this.providers.set(providerKey, {
        ...providerInfo,
        instance: null,
        isHealthy: false,
        lastHealthCheck: Date.now(),
        errorCount: providerInfo.errorCount + 1,
        isLazyLoading: false
      })
      
      throw error
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
        
        this.logger.debug(`Setting default provider: ${providerKey} with model: ${preferredModel}`)
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
    let providerData = this.providers.get(providerKey)
    if (!providerData) {
      throw new Error(`Provider ${providerKey} not available`)
    }

    // If provider is lazy loading or has no instance, load it now
    if (providerData.isLazyLoading || !providerData.instance) {
      try {
        providerData = await this.lazyLoadProvider(providerKey)
      } catch (error) {
        throw new Error(`Failed to load provider ${providerKey}: ${error.message}`)
      }
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
    if (this.app && this.app.stateManager) {
      this.app.stateManager.updateAIProvider({
        instance: this.currentProvider,
        key: this.currentProviderKey,
        model: this.currentModel,
        models: providerData.models
      })
    }

    this.stats.providerSwitches++
    this.logger.debug(`Switched to provider: ${providerKey}, model: ${this.currentModel}`)
    
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
    if (this.app && this.app.stateManager) {
      this.app.stateManager.updateModel(this.currentModel)
    }

    this.stats.modelSwitches++
    this.logger.debug(`Switched to model: ${model}`)
    
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
        isHealthy: data.isHealthy === null ? true : data.isHealthy, // Assume lazy providers are healthy until proven otherwise
        isCurrent: key === this.currentProviderKey,
        isLazyLoading: data.isLazyLoading || false
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