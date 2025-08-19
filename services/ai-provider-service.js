import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { RetryPlugin } from '../plugins/retry-plugin.js'

/**
 * Service for managing AI providers and models
 * Handles provider initialization and switching
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
    this.stats = {
      providerSwitches: 0,
      modelSwitches: 0
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
    
    // Determine default provider (preference order: openai, deepseek, anthropic)
    const preferredOrder = ['openai', 'deepseek', 'anthropic']
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
        models
      })
      
      this.logger.debug(`Default provider ${defaultProviderKey} initialized with ${models.length} models`)
      
      // Store other providers as lazy-loadable (not yet initialized)
      for (const providerKey of availableProviderKeys) {
        if (providerKey !== defaultProviderKey) {
          this.providers.set(providerKey, {
            instance: null, // Will be loaded on demand
            config: API_PROVIDERS[providerKey],
            models: [],
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
      
      // Try fallback providers (OpenAI → DeepSeek priority)
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
            models
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
      // Fail fast - no fallback models masking real problems
      throw error
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
          this.providers.get(providerKey).instance && 
          DEFAULT_MODELS[providerKey]) {
        const modelConfig = DEFAULT_MODELS[providerKey]
        const preferredModel = modelConfig.model
        
        this.logger.debug(`Setting default provider: ${providerKey} with model: ${preferredModel}`)
        await this.switchProvider(providerKey, preferredModel)
        return
      }
    }
    
    // Fallback to first available provider with its preferred model
    const availableProviders = Array.from(this.providers.entries())
      .filter(([key, data]) => data.instance)
    
    if (availableProviders.length === 0) {
      throw new Error('No providers available')
    }
    
    const [firstAvailableProviderKey, firstAvailableProviderData] = availableProviders[0]
    const fallbackModel = DEFAULT_MODELS[firstAvailableProviderKey]?.model || 'gpt-4o-mini'
    this.logger.warn(`Falling back to available provider: ${firstAvailableProviderKey} with model: ${fallbackModel}`)
    await this.switchProvider(firstAvailableProviderKey, fallbackModel)
  }

  async switchProvider(providerKey, model = null) {
    // Check if provider is configured
    const config = API_PROVIDERS[providerKey]
    if (!config || !process.env[config.apiKeyEnv]) {
      throw new Error(`Provider ${providerKey} is not configured or missing API key`)
    }

    // Update current provider info
    this.currentProviderKey = providerKey
    
    // Set model from config or parameter
    if (model) {
      this.currentModel = model
    } else {
      // Use preferred model from DEFAULT_MODELS
      this.currentModel = DEFAULT_MODELS[providerKey]?.model || 'default'
    }
    
    let providerData = this.providers.get(providerKey)
    let availableModels = []
    
    // If provider doesn't exist or is lazy loading, load it now
    if (!providerData || providerData.isLazyLoading) {
      this.logger.debug(`Loading models for provider: ${providerKey}`)
      
      try {
        // Try to lazy load the provider to get models
        providerData = await this.lazyLoadProvider(providerKey)
        availableModels = providerData.models || []
        this.logger.debug(`Successfully loaded ${availableModels.length} models for ${providerKey}`)
      } catch (error) {
        this.logger.debug(`Failed to load models for ${providerKey}: ${error.message}`)
        
        // Create placeholder with empty models if loading fails
        providerData = {
          instance: null,
          config,
          models: [],
          isLazyLoading: true
        }
        this.providers.set(providerKey, providerData)
      }
    } else {
      // Provider already loaded, use existing models
      availableModels = providerData.models || []
    }
    
    // Update app state with loaded models
    if (this.app && this.app.stateManager) {
      this.app.stateManager.updateAIProvider({
        instance: providerData.instance,
        key: this.currentProviderKey,
        model: this.currentModel,
        models: availableModels
      })
    }

    this.stats.providerSwitches++
    this.logger.info(`✅ Switched to provider: ${providerKey}, model: ${this.currentModel}, available models: ${availableModels.length}`)
    
    return {
      provider: providerKey,
      model: this.currentModel,
      availableModels: availableModels
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
      .filter(key => key !== currentKey && this.providers.get(key).instance)

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
      hasCurrentProvider: !!this.currentProvider
    }
  }

  getAvailableProviders() {
    // Return ALL providers that have API keys, regardless of initialization status
    return Object.entries(API_PROVIDERS)
      .filter(([key, config]) => process.env[config.apiKeyEnv])
      .map(([key, config]) => ({
        key,
        name: config.name,
        models: this.providers.get(key)?.models || [],
        isCurrent: key === this.currentProviderKey,
        isLazyLoading: !this.providers.get(key)?.instance
      }))
  }

  async createChatCompletion(messages, options = {}) {
    if (!this.currentProviderKey) {
      throw new Error('No provider currently selected')
    }

    // Lazy load provider on first use
    let providerData = this.providers.get(this.currentProviderKey)
    if (!providerData || !providerData.instance) {
      try {
        this.logger.debug(`Lazy loading provider on first use: ${this.currentProviderKey}`)
        
        const config = API_PROVIDERS[this.currentProviderKey]
        this.logger.debug(`Config for ${this.currentProviderKey}:`, config)
        
        this.logger.debug(`Creating provider instance...`)
        const provider = createProvider(this.currentProviderKey, config)
        
        this.logger.debug(`Initializing client for ${this.currentProviderKey}...`)
        await provider.initializeClient()
        
        // Enhance with retry logic
        this.retryPlugin.enhanceInstanceWithRetry(provider)
        
        // Update provider data
        providerData = {
          instance: provider,
          config,
          models: [], // Don't load models unless needed
          isLazyLoading: false
        }
        this.providers.set(this.currentProviderKey, providerData)
        this.currentProvider = provider
        
        this.logger.debug(`Provider ${this.currentProviderKey} loaded successfully`)
      } catch (error) {
        this.logger.error(`REAL ERROR for ${this.currentProviderKey}:`, error.message)
        this.logger.error(`Error stack:`, error.stack)
        // Throw original error without wrapping to see real cause
        throw error
      }
    } else {
      this.currentProvider = providerData.instance
    }

    return await this.currentProvider.createChatCompletion(
      this.currentModel,
      messages,
      options
    )
  }



  getProviderStats() {
    return {
      ...this.stats,
      totalProviders: this.providers.size,
      availableProviders: Array.from(this.providers.values()).filter(p => p.instance).length,
      currentProvider: this.currentProviderKey,
      currentModel: this.currentModel
    }
  }

  getHealthStatus() {
    const availableProviders = Array.from(this.providers.values()).filter(p => p.instance).length
    
    return {
      initialized: this.initialized,
      totalProviders: this.providers.size,
      availableProviders,
      hasCurrentProvider: !!this.currentProvider,
      isReady: this.initialized && availableProviders > 0 && !!this.currentProvider
    }
  }


  dispose() {
    this.providers.clear()
    this.currentProvider = null
    this.currentProviderKey = null
    this.currentModel = null
    this.initialized = false
    this.logger.debug('AIProviderService disposed')
  }
}