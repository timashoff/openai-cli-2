import { BaseService } from './base-service.js'
import { AppError } from '../utils/error-handler.js'
import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { APP_CONSTANTS } from '../config/constants.js'

/**
 * Service responsible for managing AI providers and their lifecycle
 * - Provider initialization and health monitoring
 * - Model listing and validation
 * - Provider switching with fallback strategies
 * - Connection pooling and retry logic
 */
export class ProviderService extends BaseService {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Map<string, Object>} */
    this.providers = new Map()
    /** @type {Map<string, string[]>} */
    this.providerModels = new Map()
    /** @type {Map<string, ProviderHealthStatus>} */
    this.healthStatus = new Map()
    /** @type {string|null} */
    this.currentProviderKey = null
    /** @type {Object|null} */
    this.currentProvider = null
    /** @type {string} */
    this.currentModel = ''
    /** @type {number} */
    this.switchAttempts = 0
    /** @type {Set<string>} */
    this.failedProviders = new Set()
  }

  /**
   * @override
   */
  getRequiredDependencies() {
    return ['eventBus', 'logger', 'config']
  }

  /**
   * @override
   */
  async onInitialize() {
    await this.loadProviderConfigurations()
    await this.initializeDefaultProvider()
    this.startHealthMonitoring()
    this.log('info', 'ProviderService initialized')
  }

  /**
   * @override
   */
  async onDispose() {
    await this.disconnectAllProviders()
    this.stopHealthMonitoring()
    this.log('info', 'ProviderService disposed')
  }

  /**
   * Switch to specified provider
   * @param {string} providerKey - Provider key to switch to
   * @param {Object} options - Switch options
   * @param {boolean} options.force - Force switch even if provider is unhealthy
   * @param {boolean} options.autoSelect - Auto-select if provider is null
   * @returns {Promise<Object>} Provider switch result
   */
  async switchProvider(providerKey = null, options = {}) {
    this.ensureReady()
    
    const { force = false, autoSelect = false } = options
    
    this.log('info', `Switching provider to: ${providerKey || 'auto-select'}`)
    
    try {
      // Auto-select default provider if none specified
      if (!providerKey && autoSelect) {
        providerKey = this.selectDefaultProvider()
      }

      if (!providerKey) {
        throw new AppError('Provider key is required for switching', true, 400)
      }

      // Check if provider is available
      if (!this.isProviderAvailable(providerKey)) {
        throw new AppError(`Provider '${providerKey}' is not available`, true, 404)
      }

      // Check provider health unless forced
      if (!force && !this.isProviderHealthy(providerKey)) {
        this.log('warn', `Provider '${providerKey}' is unhealthy, attempting fallback`)
        providerKey = await this.selectHealthyProvider(providerKey)
      }

      // Initialize provider if not already done
      const provider = await this.initializeProvider(providerKey)
      
      // Load models for the provider
      const models = await this.loadProviderModels(providerKey)
      
      // Select appropriate model
      const selectedModel = this.selectModel(models)
      
      // Update current provider state
      this.setCurrentProvider(providerKey, provider, selectedModel, models)
      
      // Emit provider switch event
      this.emitEvent('provider:switched', {
        previousProvider: this.currentProviderKey,
        newProvider: providerKey,
        model: selectedModel,
        modelsCount: models.length
      })

      this.log('info', `Successfully switched to provider '${providerKey}' with model '${selectedModel}'`)
      
      return {
        providerKey,
        provider,
        model: selectedModel,
        models,
        success: true
      }

    } catch (error) {
      this.handleProviderSwitchError(providerKey, error)
      throw error
    }
  }

  /**
   * Get current provider information
   * @returns {Object|null} Current provider info
   */
  getCurrentProvider() {
    if (!this.currentProvider || !this.currentProviderKey) {
      return null
    }

    return {
      key: this.currentProviderKey,
      name: this.getProviderName(this.currentProviderKey),
      provider: this.currentProvider,
      model: this.currentModel,
      models: this.providerModels.get(this.currentProviderKey) || [],
      health: this.healthStatus.get(this.currentProviderKey),
      isReady: this.isProviderReady(this.currentProviderKey)
    }
  }

  /**
   * Get all available providers with status
   * @returns {Object[]} Array of provider information
   */
  getAvailableProviders() {
    const providers = []
    
    for (const [key, config] of Object.entries(API_PROVIDERS)) {
      const health = this.healthStatus.get(key)
      const models = this.providerModels.get(key) || []
      
      providers.push({
        key,
        name: config.name,
        isAvailable: this.isProviderAvailable(key),
        isHealthy: this.isProviderHealthy(key),
        isReady: this.isProviderReady(key),
        isCurrent: key === this.currentProviderKey,
        modelsCount: models.length,
        health,
        hasApiKey: this.hasValidApiKey(key)
      })
    }
    
    return providers.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Try alternative provider when current fails
   * @param {string} failedProvider - Provider that failed
   * @returns {Promise<Object|null>} Alternative provider or null
   */
  async tryAlternativeProvider(failedProvider = null) {
    this.log('info', `Trying alternative provider, failed: ${failedProvider}`)
    
    if (failedProvider) {
      this.failedProviders.add(failedProvider)
      this.updateProviderHealth(failedProvider, false, 'Provider failed during operation')
    }

    // Get healthy providers excluding failed ones
    const healthyProviders = this.getHealthyProviders()
      .filter(key => !this.failedProviders.has(key))
    
    if (healthyProviders.length === 0) {
      this.log('error', 'No healthy alternative providers available')
      return null
    }

    // Try providers in order of preference
    const preferredOrder = ['openai', 'anthropic', 'deepseek']
    const sortedProviders = [
      ...healthyProviders.filter(p => preferredOrder.includes(p)),
      ...healthyProviders.filter(p => !preferredOrder.includes(p))
    ]

    for (const providerKey of sortedProviders) {
      try {
        const result = await this.switchProvider(providerKey, { force: false })
        this.log('info', `Successfully switched to alternative provider: ${providerKey}`)
        return result
      } catch (error) {
        this.log('warn', `Alternative provider ${providerKey} also failed: ${error.message}`)
        this.failedProviders.add(providerKey)
        continue
      }
    }

    this.log('error', 'All alternative providers failed')
    return null
  }

  /**
   * Refresh models for current or specified provider
   * @param {string} providerKey - Provider key (defaults to current)
   * @returns {Promise<string[]>} Updated model list
   */
  async refreshModels(providerKey = null) {
    providerKey = providerKey || this.currentProviderKey
    
    if (!providerKey) {
      throw new AppError('No provider specified or current provider not set', true, 400)
    }

    this.log('info', `Refreshing models for provider: ${providerKey}`)
    
    try {
      const models = await this.loadProviderModels(providerKey, true) // Force refresh
      this.emitEvent('models:refreshed', { providerKey, modelsCount: models.length })
      return models
    } catch (error) {
      this.log('error', `Failed to refresh models for ${providerKey}: ${error.message}`)
      throw error
    }
  }

  /**
   * Switch model for current provider
   * @param {string} modelId - Model ID to switch to
   * @returns {Promise<boolean>} Success status
   */
  async switchModel(modelId) {
    if (!this.currentProviderKey) {
      throw new AppError('No current provider set', true, 400)
    }

    const models = this.providerModels.get(this.currentProviderKey) || []
    
    if (!models.includes(modelId)) {
      throw new AppError(`Model '${modelId}' not available for provider '${this.currentProviderKey}'`, true, 404)
    }

    const previousModel = this.currentModel
    this.currentModel = modelId
    
    this.emitEvent('model:switched', {
      providerKey: this.currentProviderKey,
      previousModel,
      newModel: modelId
    })

    this.log('info', `Switched model to: ${modelId}`)
    return true
  }

  /**
   * Initialize provider instance
   * @private
   * @param {string} providerKey - Provider key
   * @returns {Promise<Object>} Provider instance
   */
  async initializeProvider(providerKey) {
    let provider = this.providers.get(providerKey)
    
    if (!provider) {
      const config = API_PROVIDERS[providerKey]
      if (!config) {
        throw new AppError(`Provider configuration not found: ${providerKey}`, true, 404)
      }

      this.log('debug', `Creating new provider instance: ${providerKey}`)
      provider = createProvider(providerKey, config)
      this.providers.set(providerKey, provider)
    }

    // Initialize provider if not already done
    if (!provider.client) {
      this.log('debug', `Initializing provider client: ${providerKey}`)
      await provider.initializeClient()
    }

    this.updateProviderHealth(providerKey, true, 'Provider initialized successfully')
    return provider
  }

  /**
   * Load models for provider with caching
   * @private
   * @param {string} providerKey - Provider key
   * @param {boolean} forceRefresh - Force refresh cache
   * @returns {Promise<string[]>} Model list
   */
  async loadProviderModels(providerKey, forceRefresh = false) {
    // Return cached models if available and not forcing refresh
    if (!forceRefresh && this.providerModels.has(providerKey)) {
      const models = this.providerModels.get(providerKey)
      this.log('debug', `Using cached models for ${providerKey}: ${models.length} models`)
      return models
    }

    const provider = await this.initializeProvider(providerKey)
    
    this.log('debug', `Loading models for provider: ${providerKey}`)
    
    try {
      const modelList = await provider.listModels()
      const modelIds = modelList.map(m => m.id).sort((a, b) => a.localeCompare(b))
      
      this.providerModels.set(providerKey, modelIds)
      this.log('info', `Loaded ${modelIds.length} models for provider: ${providerKey}`)
      
      return modelIds
    } catch (error) {
      this.updateProviderHealth(providerKey, false, `Failed to load models: ${error.message}`)
      throw new AppError(`Failed to load models for provider ${providerKey}: ${error.message}`, true, 500)
    }
  }

  /**
   * Select appropriate model from list
   * @private
   * @param {string[]} models - Available models
   * @returns {string} Selected model
   */
  selectModel(models) {
    if (!models || models.length === 0) {
      throw new AppError('No models available', true, 404)
    }

    // Try to find preferred model from defaults
    const preferredModels = Object.values(DEFAULT_MODELS).map(config => config.model)
    for (const defaultModel of preferredModels) {
      const match = models.find(modelId => modelId.includes(defaultModel))
      if (match) {
        this.log('debug', `Selected preferred model: ${match}`)
        return match
      }
    }

    // Fallback to first model
    const fallbackModel = models[0]
    this.log('debug', `No preferred model found, using fallback: ${fallbackModel}`)
    return fallbackModel
  }

  /**
   * Set current provider state
   * @private
   */
  setCurrentProvider(providerKey, provider, model, models) {
    this.currentProviderKey = providerKey
    this.currentProvider = provider
    this.currentModel = model
    this.providerModels.set(providerKey, models)
    
    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = model
    }
  }

  /**
   * Select default provider
   * @private
   * @returns {string} Default provider key
   */
  selectDefaultProvider() {
    const defaultKey = APP_CONSTANTS.DEFAULT_PROVIDER
    
    if (this.isProviderAvailable(defaultKey)) {
      return defaultKey
    }

    // Fallback to first available provider
    const available = Object.keys(API_PROVIDERS).find(key => this.isProviderAvailable(key))
    if (!available) {
      throw new AppError('No providers available', true, 503)
    }

    return available
  }

  /**
   * Select healthy provider excluding specified ones
   * @private
   * @param {string} excludeProvider - Provider to exclude
   * @returns {Promise<string>} Healthy provider key
   */
  async selectHealthyProvider(excludeProvider) {
    const healthyProviders = this.getHealthyProviders()
      .filter(key => key !== excludeProvider)
    
    if (healthyProviders.length === 0) {
      throw new AppError('No healthy providers available', true, 503)
    }

    return healthyProviders[0]
  }

  /**
   * Get list of healthy providers
   * @private
   * @returns {string[]} Healthy provider keys
   */
  getHealthyProviders() {
    return Object.keys(API_PROVIDERS)
      .filter(key => this.isProviderHealthy(key))
      .filter(key => this.hasValidApiKey(key))
  }

  /**
   * Check if provider is available (has config and API key)
   * @private
   * @param {string} providerKey - Provider key
   * @returns {boolean} True if available
   */
  isProviderAvailable(providerKey) {
    return !!(API_PROVIDERS[providerKey] && this.hasValidApiKey(providerKey))
  }

  /**
   * Check if provider is healthy
   * @private
   * @param {string} providerKey - Provider key
   * @returns {boolean} True if healthy
   */
  isProviderHealthy(providerKey) {
    const health = this.healthStatus.get(providerKey)
    return health ? health.isHealthy : false
  }

  /**
   * Check if provider is ready for use
   * @private
   * @param {string} providerKey - Provider key
   * @returns {boolean} True if ready
   */
  isProviderReady(providerKey) {
    return this.isProviderAvailable(providerKey) && 
           this.isProviderHealthy(providerKey) &&
           this.providers.has(providerKey)
  }

  /**
   * Check if provider has valid API key
   * @private
   * @param {string} providerKey - Provider key
   * @returns {boolean} True if has valid API key
   */
  hasValidApiKey(providerKey) {
    const config = API_PROVIDERS[providerKey]
    return !!(config && process.env[config.apiKeyEnv])
  }

  /**
   * Get provider display name
   * @private
   * @param {string} providerKey - Provider key
   * @returns {string} Provider name
   */
  getProviderName(providerKey) {
    return API_PROVIDERS[providerKey]?.name || providerKey
  }

  /**
   * Load provider configurations
   * @private
   */
  async loadProviderConfigurations() {
    this.log('debug', 'Loading provider configurations')
    
    for (const [key, config] of Object.entries(API_PROVIDERS)) {
      const hasApiKey = this.hasValidApiKey(key)
      
      this.healthStatus.set(key, {
        isHealthy: hasApiKey,
        lastCheck: new Date(),
        error: hasApiKey ? null : 'API key not found',
        responseTime: null
      })
      
      this.log('debug', `Provider ${key}: ${hasApiKey ? 'available' : 'unavailable (no API key)'}`)
    }
  }

  /**
   * Initialize default provider
   * @private
   */
  async initializeDefaultProvider() {
    try {
      await this.switchProvider(null, { autoSelect: true })
    } catch (error) {
      this.log('error', `Failed to initialize default provider: ${error.message}`)
      throw new AppError('No providers available for initialization', true, 503)
    }
  }

  /**
   * Start health monitoring for providers
   * @private
   */
  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks()
    }, 60000) // Check every minute
  }

  /**
   * Stop health monitoring
   * @private
   */
  stopHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  /**
   * Perform health checks on all providers
   * @private
   */
  async performHealthChecks() {
    for (const providerKey of Object.keys(API_PROVIDERS)) {
      if (!this.hasValidApiKey(providerKey)) continue
      
      try {
        await this.checkProviderHealth(providerKey)
      } catch (error) {
        this.log('warn', `Health check failed for ${providerKey}: ${error.message}`)
      }
    }
  }

  /**
   * Check individual provider health
   * @private
   * @param {string} providerKey - Provider key
   */
  async checkProviderHealth(providerKey) {
    const startTime = Date.now()
    
    try {
      const provider = await this.initializeProvider(providerKey)
      
      // Simple health check by listing models
      await provider.listModels()
      
      const responseTime = Date.now() - startTime
      this.updateProviderHealth(providerKey, true, null, responseTime)
      
    } catch (error) {
      const responseTime = Date.now() - startTime
      this.updateProviderHealth(providerKey, false, error.message, responseTime)
    }
  }

  /**
   * Update provider health status
   * @private
   * @param {string} providerKey - Provider key
   * @param {boolean} isHealthy - Health status
   * @param {string} error - Error message if unhealthy
   * @param {number} responseTime - Response time in ms
   */
  updateProviderHealth(providerKey, isHealthy, error = null, responseTime = null) {
    this.healthStatus.set(providerKey, {
      isHealthy,
      lastCheck: new Date(),
      error,
      responseTime
    })

    if (!isHealthy) {
      this.emitEvent('provider:unhealthy', { providerKey, error })
    }
  }

  /**
   * Handle provider switch errors
   * @private
   * @param {string} providerKey - Provider key
   * @param {Error} error - Switch error
   */
  handleProviderSwitchError(providerKey, error) {
    this.switchAttempts++
    this.updateProviderHealth(providerKey, false, error.message)
    
    this.emitEvent('provider:switch:failed', {
      providerKey,
      error: error.message,
      attempts: this.switchAttempts
    })

    this.log('error', `Provider switch failed for ${providerKey}: ${error.message}`)
  }

  /**
   * Disconnect all providers
   * @private
   */
  async disconnectAllProviders() {
    this.log('info', 'Disconnecting all providers')
    
    for (const [key, provider] of this.providers) {
      try {
        if (provider && typeof provider.dispose === 'function') {
          await provider.dispose()
        }
      } catch (error) {
        this.log('warn', `Error disconnecting provider ${key}: ${error.message}`)
      }
    }
    
    this.providers.clear()
    this.providerModels.clear()
    this.currentProvider = null
    this.currentProviderKey = null
    this.currentModel = ''
  }

  /**
   * @override
   */
  getCustomMetrics() {
    return {
      currentProvider: this.currentProviderKey,
      currentModel: this.currentModel,
      totalProviders: Object.keys(API_PROVIDERS).length,
      availableProviders: Object.keys(API_PROVIDERS).filter(k => this.isProviderAvailable(k)).length,
      healthyProviders: this.getHealthyProviders().length,
      switchAttempts: this.switchAttempts,
      failedProviders: this.failedProviders.size,
      providersHealth: Object.fromEntries(this.healthStatus)
    }
  }
}