import { color } from '../config/color.js'
import { createProvider } from './provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { logger } from './logger.js'
import { getElapsedTime } from './index.js'
import { StreamProcessor } from './stream-processor.js'

/**
 * Configuration for multi-provider translations
 */
const TRANSLATION_PROVIDERS = {
  // For English translations (aa)
  ENGLISH: [
    { key: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o-mini' },
    { key: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek-chat' }
  ],
  
  // For Russian translations (rr) 
  RUSSIAN: [
    { key: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o-mini' },
    { key: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek-chat' }
  ],
  
  // For Chinese translations (cc)
  CHINESE: [
    { key: 'openai', model: 'gpt-4o-mini', name: 'GPT-4o-mini' },
    { key: 'deepseek', model: 'deepseek-chat', name: 'DeepSeek-chat' }
  ],

  // For document translations (doc) - only Claude Sonnet
  DOC: [
    { key: 'anthropic', model: 'claude-3-5-sonnet-20241022', name: 'Claude Sonnet' }
  ]
}

/**
 * Multi-provider translator class
 */
export class MultiProviderTranslator {
  constructor() {
    this.providers = new Map()
    this.isInitialized = false
  }

  /**
   * Initialize providers
   */
  async initialize() {
    if (this.isInitialized) return
    
    try {
      // Initialize only available providers
      for (const [providerKey, config] of Object.entries(API_PROVIDERS)) {
        if (process.env[config.apiKeyEnv]) {
          const provider = createProvider(providerKey, config)
          await provider.initializeClient()
          this.providers.set(providerKey, provider)
          logger.debug(`Multi-provider translator: ${providerKey} initialized`)
        }
      }
      
      this.isInitialized = true
      logger.debug(`Multi-provider translator initialized with ${this.providers.size} providers`)
    } catch (error) {
      logger.error('Failed to initialize multi-provider translator:', error)
      throw error
    }
  }

  /**
   * Get available providers for command
   */
  getProvidersForCommand(commandKey) {
    const providers = TRANSLATION_PROVIDERS[commandKey] || []
    return providers.filter(provider => this.providers.has(provider.key))
  }

  /**
   * Translate using single provider
   */
  async translateWithProvider(provider, model, instruction, text, signal) {
    try {
      const providerInstance = this.providers.get(provider.key)
      if (!providerInstance) {
        throw new Error(`Provider ${provider.key} not available`)
      }

      const messages = [{ role: 'user', content: `${instruction}: ${text}` }]
      
      const stream = await providerInstance.createChatCompletion(model, messages, {
        stream: true,
        signal
      })

      // Use existing StreamProcessor to handle different provider formats
      const streamProcessor = new StreamProcessor(provider.key)
      const chunks = await streamProcessor.processStream(stream, signal)
      
      const response = chunks.join('').trim()

      return {
        provider: provider.name,
        model: model,
        response: response,
        error: null
      }
    } catch (error) {
      // Handle abort gracefully
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        return {
          provider: provider.name,
          model: model,
          response: null,
          error: 'Request cancelled'
        }
      }
      
      return {
        provider: provider.name,
        model: model,
        response: null,
        error: error.message
      }
    }
  }

  /**
   * Translate using multiple providers in parallel
   */
  async translateMultiple(commandKey, instruction, text, signal, customModels = null) {
    let providers

    if (customModels && customModels.length > 0) {
      // Use custom models from database
      providers = customModels.map(modelConfig => ({
        key: modelConfig.provider,
        model: modelConfig.model,
        name: API_PROVIDERS[modelConfig.provider]?.name || modelConfig.provider
      })).filter(provider => this.providers.has(provider.key))
    } else {
      // Fallback to hardcoded providers for backward compatibility
      providers = this.getProvidersForCommand(commandKey)
    }
    
    if (providers.length === 0) {
      throw new Error('No providers available for multi-provider translation')
    }

    const startTime = Date.now()
    logger.debug(`Starting multi-provider translation with ${providers.length} providers`)

    // Create promises for parallel execution
    const promises = providers.map(provider => 
      this.translateWithProvider(provider, provider.model, instruction, text, signal)
    )

    try {
      // Wait for all providers to complete
      const results = await Promise.allSettled(promises)
      
      const translations = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value
        } else {
          return {
            provider: providers[index].name,
            model: providers[index].model,
            response: null,
            error: result.reason?.message || 'Unknown error'
          }
        }
      })

      const elapsed = getElapsedTime(startTime)
      logger.debug(`Multi-provider translation completed in ${elapsed}s`)

      return {
        translations,
        elapsed,
        successful: translations.filter(t => t.response && !t.error).length,
        total: providers.length
      }
    } catch (error) {
      logger.error('Multi-provider translation failed:', error)
      throw error
    }
  }

  /**
   * Translate using single model (for doc command and single-model commands)
   */
  async translateSingle(instruction, text, signal, customModel = null, defaultModel = null) {
    let model

    if (customModel && customModel.length > 0) {
      // Use first custom model
      model = {
        key: customModel[0].provider,
        model: customModel[0].model,
        name: API_PROVIDERS[customModel[0].provider]?.name || customModel[0].provider
      }
    } else if (defaultModel) {
      // Use provided default model
      model = defaultModel
    } else {
      // Fallback to hardcoded Claude Sonnet for doc command
      model = { key: 'anthropic', model: 'claude-3-5-sonnet-20241022', name: 'Claude Sonnet' }
    }

    if (!this.providers.has(model.key)) {
      throw new Error(`Provider ${model.key} not available`)
    }

    const startTime = Date.now()
    logger.debug(`Starting single-model translation with ${model.name}`)

    try {
      const result = await this.translateWithProvider(model, model.model, instruction, text, signal)
      
      const elapsed = getElapsedTime(startTime)
      logger.debug(`Single-model translation completed in ${elapsed}s`)

      return {
        result,
        elapsed
      }
    } catch (error) {
      logger.error('Single-model translation failed:', error)
      throw error
    }
  }

  /**
   * Format multi-provider response for display
   */
  formatMultiProviderResponse(result) {
    let output = ''
    
    for (const translation of result.translations) {
      const providerLabel = translation.model 
        ? `${translation.provider} (${translation.model})`
        : translation.provider
      output += `\n${color.cyan}${providerLabel}${color.reset}:\n`
      
      if (translation.error) {
        output += `${color.red}Error: ${translation.error}${color.reset}\n`
      } else if (translation.response) {
        output += `${translation.response}\n`
      } else {
        output += `${color.yellow}No response${color.reset}\n`
      }
    }
    
    // Add summary
    output += `\n${color.grey}[${result.successful}/${result.total} providers responded in ${result.elapsed}s]${color.reset}`
    
    return output
  }

  /**
   * Check if command supports multi-provider
   */
  isMultiProviderCommand(commandKey) {
    return TRANSLATION_PROVIDERS[commandKey] && 
           TRANSLATION_PROVIDERS[commandKey].length > 1
  }

  /**
   * Check if provider is available
   */
  isProviderAvailable(providerKey) {
    return this.providers.has(providerKey)
  }
}

// Export singleton instance
export const multiProviderTranslator = new MultiProviderTranslator()