import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
// RetryPlugin removed - was theatrical code that never worked in practice
import { createSpinner } from '../utils/spinner.js'
import { outputHandler } from '../core/output-handler.js'
import { getStateManager } from '../core/StateManager.js'

/**
 * AIProviderService - Functional approach (NO CLASSES per CLAUDE.md!)
 * Operations for AI providers, state stored in StateManager
 */

// Dependencies
let stateManager = null
// retryPlugin removed - theatrical code
let stats = {
  providerSwitches: 0,
  modelSwitches: 0
}

/**
 * Create AI Provider Service - functional factory
 */
export function createAIProviderService(dependencies = {}) {
  // Get StateManager instance (Single Source of Truth)
  stateManager = dependencies.stateManager || getStateManager()
  
  // RetryPlugin initialization removed - was theatrical code
  
  // Return service object with methods
  return {
    initialize,
    initializeAvailableProviders,
    lazyLoadProvider,
    loadModelsForProvider,
    setDefaultProvider,
    switchProvider,
    switchModel,
    tryAlternativeProvider,
    getCurrentProvider,
    getAvailableProviders,
    createChatCompletion,
    getProviderStats,
    getHealthStatus,
    dispose
  }
}

/**
 * Initialize the service
 */
async function initialize() {
  if (stateManager.getAIState().initialized) return
  
  try {
    await initializeAvailableProviders()
    await setDefaultProvider()
    stateManager.setServiceInitialized(true)
    logger.debug('AIProviderService initialized')
  } catch (error) {
    logger.error('Failed to initialize AIProviderService:', error)
    throw error
  }
}

/**
 * Initialize available providers
 */
async function initializeAvailableProviders() {
  logger.debug('Starting Smart Parallel Initialization for AI providers')
  
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
    
    // Retry logic removed - was theatrical code
    
    // Load models with shorter timeout for startup
    const models = await Promise.race([
      loadModelsForProvider(provider, defaultProviderKey),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Model loading timeout (5s)`)), 5000)
      )
    ])
    
    // Store in StateManager (Single Source of Truth)
    stateManager.setProvider(defaultProviderKey, {
      instance: provider,
      config,
      models
    })
    
    logger.debug(`Default provider ${defaultProviderKey} initialized with ${models.length} models`)
    
    // Store other providers as lazy-loadable (not yet initialized)
    for (const providerKey of availableProviderKeys) {
      if (providerKey !== defaultProviderKey) {
        stateManager.setProvider(providerKey, {
          instance: null, // Will be loaded on demand
          config: API_PROVIDERS[providerKey],
          models: [],
          isLazyLoading: true
        })
      }
    }
    
    logger.debug(`Smart Parallel Initialization complete: 1 provider (${defaultProviderKey})`)
    
    // Default provider initialized successfully
    const defaultModel = DEFAULT_MODELS[defaultProviderKey]?.model || models[0]?.id || 'unknown'
    logger.debug(`Default provider ready: ${API_PROVIDERS[defaultProviderKey].name} with ${defaultModel}`)
    
  } catch (error) {
    logger.debug(`Default provider ${defaultProviderKey} failed: ${error.message}`)
    
    // Try fallback providers
    const remainingProviders = preferredOrder.filter(key => 
      key !== defaultProviderKey && availableProviderKeys.includes(key)
    )
    
    let fallbackSuccess = false
    for (const fallbackProviderKey of remainingProviders) {
      try {
        logger.debug(`Trying fallback provider: ${fallbackProviderKey}`)
        
        const config = API_PROVIDERS[fallbackProviderKey]
        const provider = createProvider(fallbackProviderKey, config)
        await provider.initializeClient()
        
        // Retry enhancement removed - theatrical code
        
        const models = await Promise.race([
          loadModelsForProvider(provider, fallbackProviderKey),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Model loading timeout (5s)`)), 5000)
          )
        ])
        
        // Store in StateManager
        stateManager.setProvider(fallbackProviderKey, {
          instance: provider,
          config,
          models
        })
        
        logger.debug(`Fallback provider ${fallbackProviderKey} initialized`)
        
        // Test connectivity
        try {
          const testModel = models[0]?.id || DEFAULT_MODELS[fallbackProviderKey]?.model || 'test'
          await provider.createChatCompletion(
            testModel,
            [{ role: 'user', content: 'hi' }], 
            { stream: false, max_tokens: 1 }
          )
          logger.debug(`Fallback provider ${fallbackProviderKey} connectivity confirmed`)
          fallbackSuccess = true
        } catch (connectivityError) {
          logger.debug(`Fallback provider ${fallbackProviderKey} connectivity test failed`)
          stateManager.getAllProviders().delete(fallbackProviderKey)
          continue
        }
        
        // Store other providers as lazy-loadable
        for (const providerKey of availableProviderKeys) {
          if (providerKey !== fallbackProviderKey && providerKey !== defaultProviderKey) {
            stateManager.setProvider(providerKey, {
              instance: null,
              config: API_PROVIDERS[providerKey],
              models: [],
              isLazyLoading: true
            })
          }
        }
        
        break
        
      } catch (fallbackError) {
        logger.debug(`Fallback provider ${fallbackProviderKey} also failed: ${fallbackError.message}`)
        continue
      }
    }
    
    if (!fallbackSuccess) {
      throw new Error(`All available providers failed to initialize. Last error: ${error.message}`)
    }
  }
}

/**
 * Load models for a provider
 */
async function loadModelsForProvider(provider, providerKey) {
  try {
    const models = await provider.listModels()
    return models || []
  } catch (error) {
    logger.debug(`Failed to load models for ${providerKey}:`, error.message)
    throw error
  }
}

/**
 * Lazy load a provider on demand
 */
async function lazyLoadProvider(providerKey) {
  const providerInfo = stateManager.getProvider(providerKey)
  
  // If provider is already loaded, return it
  if (providerInfo && providerInfo.instance && !providerInfo.isLazyLoading) {
    return providerInfo
  }
  
  // If provider doesn't exist or has no config, cannot load
  if (!providerInfo || !providerInfo.config) {
    throw new Error(`Provider ${providerKey} not available`)
  }
  
  const spinner = createSpinner()
  const providerName = API_PROVIDERS[providerKey]?.name || providerKey
  
  try {
    // Start spinner with provider name on separate line
    outputHandler.writeInfo(`Loading AI provider: ${providerName}...`)
    spinner.start()
    
    logger.debug(`Lazy loading provider: ${providerKey}`)
    
    const provider = createProvider(providerKey, providerInfo.config)
    await provider.initializeClient()
    
    // Retry logic removed - was theatrical code
    
    // Load models with timeout
    const models = await Promise.race([
      loadModelsForProvider(provider, providerKey),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Model loading timeout (10s)`)), 10000)
      )
    ])
    
    // Update provider info in StateManager
    const updatedProviderInfo = {
      instance: provider,
      config: providerInfo.config,
      models,
      isLazyLoading: false
    }
    
    stateManager.setProvider(providerKey, updatedProviderInfo)
    
    // Stop spinner with success
    spinner.stop('success')
    
    logger.debug(`Provider ${providerKey} lazy loaded with ${models.length} models`)
    
    return updatedProviderInfo
    
  } catch (error) {
    // Stop spinner with error
    spinner.stop('error')
    
    logger.debug(`Failed to lazy load provider ${providerKey}:`, error.message)
    
    // Update provider as failed in StateManager
    stateManager.setProvider(providerKey, {
      ...providerInfo,
      instance: null,
      isLazyLoading: false
    })
    
    throw error
  }
}

/**
 * Set default provider
 */
async function setDefaultProvider() {
  // Try to find preferred provider from DEFAULT_MODELS
  const preferredOrder = ['openai', 'deepseek', 'anthropic']
  const providers = stateManager.getAllProviders()
  
  for (const providerKey of preferredOrder) {
    const providerData = providers.get(providerKey)
    if (providerData && providerData.instance && DEFAULT_MODELS[providerKey]) {
      const modelConfig = DEFAULT_MODELS[providerKey]
      const preferredModel = modelConfig.model
      
      logger.debug(`Setting default provider: ${providerKey} with model: ${preferredModel}`)
      await switchProvider(providerKey, preferredModel)
      return
    }
  }
  
  // Fallback to first available provider
  const availableProviders = Array.from(providers.entries())
    .filter(([key, data]) => data.instance)
  
  if (availableProviders.length === 0) {
    throw new Error('No providers available')
  }
  
  const [firstProviderKey] = availableProviders[0]
  const fallbackModel = DEFAULT_MODELS[firstProviderKey]?.model || 'gpt-4o-mini'
  logger.warn(`Falling back to available provider: ${firstProviderKey} with model: ${fallbackModel}`)
  await switchProvider(firstProviderKey, fallbackModel)
}

/**
 * Switch to a different provider
 */
async function switchProvider(providerKey, model = null) {
  // Check if provider is configured
  const config = API_PROVIDERS[providerKey]
  if (!config || !process.env[config.apiKeyEnv]) {
    throw new Error(`Provider ${providerKey} is not configured or missing API key`)
  }
  
  // Set model from config or parameter
  const targetModel = model || DEFAULT_MODELS[providerKey]?.model || 'default'
  
  let providerData = stateManager.getProvider(providerKey)
  let availableModels = []
  
  // If provider doesn't exist or is lazy loading, load it now
  if (!providerData || providerData.isLazyLoading) {
    logger.debug(`Loading models for provider: ${providerKey}`)
    
    try {
      // Try to lazy load the provider to get models
      providerData = await lazyLoadProvider(providerKey)
      availableModels = providerData.models || []
      logger.debug(`Successfully loaded ${availableModels.length} models for ${providerKey}`)
    } catch (error) {
      logger.debug(`Failed to load models for ${providerKey}: ${error.message}`)
      
      // Create placeholder in StateManager if loading fails
      providerData = {
        instance: null,
        config,
        models: [],
        isLazyLoading: true
      }
      stateManager.setProvider(providerKey, providerData)
    }
  } else {
    // Provider already loaded, use existing models
    availableModels = providerData.models || []
  }
  
  // Update StateManager with new current provider
  stateManager.updateAIProvider({
    instance: providerData.instance,
    key: providerKey,
    model: targetModel,
    models: availableModels,
    config: providerData.config
  })
  
  stats.providerSwitches++
  logger.debug(`✓ Switched to provider: ${providerKey}, model: ${targetModel}, available models: ${availableModels.length}`)
  
  return {
    provider: providerKey,
    model: targetModel,
    availableModels: availableModels
  }
}

/**
 * Switch to a different model
 */
async function switchModel(model) {
  const currentProviderKey = stateManager.getCurrentProviderKey()
  
  if (!currentProviderKey) {
    throw new Error('No provider currently active')
  }
  
  const providerData = stateManager.getProvider(currentProviderKey)
  
  // Check if model is available
  const modelExists = providerData.models.some(m => {
    return typeof m === 'string' ? m === model : (m.id === model || m.name === model)
  })
  
  if (!modelExists) {
    throw new Error(`Model ${model} not available for provider ${currentProviderKey}`)
  }
  
  // Update model in StateManager
  stateManager.updateModel(model)
  
  stats.modelSwitches++
  logger.debug(`Switched to model: ${model}`)
  
  return { model }
}

/**
 * Try switching to an alternative provider on error
 */
async function tryAlternativeProvider() {
  const providers = stateManager.getAllProviders()
  if (providers.size <= 1) {
    return false
  }
  
  const currentKey = stateManager.getCurrentProviderKey()
  const availableProviders = Array.from(providers.keys())
    .filter(key => key !== currentKey && providers.get(key).instance)
  
  if (availableProviders.length === 0) {
    return false
  }
  
  try {
    const nextProvider = availableProviders[0]
    await switchProvider(nextProvider)
    
    console.log(`${color.yellow}Switched to alternative provider: ${nextProvider}${color.reset}`)
    return true
  } catch (error) {
    logger.error('Failed to switch to alternative provider:', error)
    return false
  }
}

/**
 * Get current provider info from StateManager
 */
function getCurrentProvider() {
  const state = stateManager.getAIState()
  return {
    key: state.currentProviderKey,
    instance: state.currentProvider,
    model: state.currentModel,
    hasCurrentProvider: !!state.currentProvider
  }
}

/**
 * Get list of available providers
 */
function getAvailableProviders() {
  // Return ALL providers that have API keys, regardless of initialization status
  return Object.entries(API_PROVIDERS)
    .filter(([key, config]) => process.env[config.apiKeyEnv])
    .map(([key, config]) => {
      const providerData = stateManager.getProvider(key)
      return {
        key,
        name: config.name,
        models: providerData?.models || [],
        isCurrent: key === stateManager.getCurrentProviderKey(),
        isLazyLoading: !providerData?.instance
      }
    })
}

/**
 * Create chat completion using current provider
 */
async function createChatCompletion(messages, options = {}) {
  const currentProviderKey = stateManager.getCurrentProviderKey()
  
  if (!currentProviderKey) {
    throw new Error('No provider currently selected')
  }
  
  // Lazy load provider on first use
  let providerData = stateManager.getProvider(currentProviderKey)
  let currentProvider = providerData?.instance
  
  if (!currentProvider) {
    try {
      logger.debug(`Lazy loading provider on first use: ${currentProviderKey}`)
      
      const config = API_PROVIDERS[currentProviderKey]
      logger.debug(`Config for ${currentProviderKey}:`, config)
      
      logger.debug(`Creating provider instance...`)
      const provider = createProvider(currentProviderKey, config)
      
      logger.debug(`Initializing client for ${currentProviderKey}...`)
      await provider.initializeClient()
      
      // Retry logic removed - theatrical code
      
      // Update provider data in StateManager
      providerData = {
        instance: provider,
        config,
        models: [], // Don't load models unless needed
        isLazyLoading: false
      }
      stateManager.setProvider(currentProviderKey, providerData)
      currentProvider = provider
      
      // Update current provider in state
      stateManager.updateAIProvider({
        instance: provider,
        key: currentProviderKey,
        model: stateManager.getCurrentModel(),
        models: [],
        config
      })
      
      logger.debug(`Provider ${currentProviderKey} loaded successfully`)
    } catch (error) {
      logger.error(`REAL ERROR for ${currentProviderKey}:`, error.message)
      logger.error(`Error stack:`, error.stack)
      throw error
    }
  }
  
  const currentModel = stateManager.getCurrentModel()
  return await currentProvider.createChatCompletion(
    currentModel,
    messages,
    options
  )
}

/**
 * Get provider statistics
 */
function getProviderStats() {
  const providers = stateManager.getAllProviders()
  return {
    ...stats,
    totalProviders: providers.size,
    availableProviders: Array.from(providers.values()).filter(p => p.instance).length,
    currentProvider: stateManager.getCurrentProviderKey(),
    currentModel: stateManager.getCurrentModel()
  }
}

/**
 * Get health status
 */
function getHealthStatus() {
  const providers = stateManager.getAllProviders()
  const availableProviders = Array.from(providers.values()).filter(p => p.instance).length
  const state = stateManager.getAIState()
  
  return {
    initialized: state.initialized,
    totalProviders: providers.size,
    availableProviders,
    hasCurrentProvider: !!state.currentProvider,
    isReady: state.initialized && availableProviders > 0 && !!state.currentProvider
  }
}

/**
 * Dispose and cleanup
 */
function dispose() {
  // Clear StateManager
  stateManager.getAllProviders().clear()
  stateManager.updateAIProvider({
    instance: null,
    key: '',
    model: '',
    models: []
  })
  stateManager.setServiceInitialized(false)
  logger.debug('AIProviderService disposed')
}

/**
 * Export singleton instance for backward compatibility
 */
export const AIProviderService = createAIProviderService()