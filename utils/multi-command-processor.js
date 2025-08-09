import { color } from '../config/color.js'
import { createProvider } from './provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { logger } from './logger.js'
import { getElapsedTime } from './index.js'
import { StreamProcessor } from './stream-processor.js'

/**
 * Universal multi-command processor for ANY commands with multiple models
 * Extends beyond just translations to all types of AI commands
 */
export class MultiCommandProcessor {
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
          logger.debug(`Multi-command processor: ${providerKey} initialized`)
        }
      }
      
      this.isInitialized = true
      logger.debug(`Multi-command processor initialized with ${this.providers.size} providers`)
    } catch (error) {
      logger.error('Failed to initialize multi-command processor:', error)
      throw error
    }
  }

  /**
   * Execute command with single provider/model
   */
  async executeWithProvider(provider, model, instruction, signal) {
    try {
      const providerInstance = this.providers.get(provider.key)
      if (!providerInstance) {
        throw new Error(`Provider ${provider.key} not available`)
      }

      const messages = [{ role: 'user', content: instruction }]
      
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
   * Execute command with streaming support for real-time display
   */
  async executeWithStreamingDisplay(provider, model, instruction, signal, onChunkCallback = null) {
    try {
      const providerInstance = this.providers.get(provider.key)
      if (!providerInstance) {
        throw new Error(`Provider ${provider.key} not available`)
      }

      const messages = [{ role: 'user', content: instruction }]
      
      const stream = await providerInstance.createChatCompletion(model, messages, {
        stream: true,
        signal
      })

      // Use existing StreamProcessor but with chunk callback for real-time display
      const streamProcessor = new StreamProcessor(provider.key)
      const response = []
      
      const chunkHandler = (content) => {
        response.push(content)
        if (onChunkCallback) {
          onChunkCallback(content)
        }
      }
      
      await streamProcessor.processStream(stream, signal, chunkHandler)
      
      return {
        provider: provider.name,
        model: model,
        response: response.join('').trim(),
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
   * Execute command with multiple models in parallel (sequential display)
   */
  async executeMultiple(instruction, signal, customModels, defaultModel = null, onProviderComplete = null) {
    let providers = []

    if (customModels && customModels.length > 0) {
      // Use custom models from database
      providers = customModels.map(modelConfig => ({
        key: modelConfig.provider,
        model: modelConfig.model,
        name: API_PROVIDERS[modelConfig.provider]?.name || modelConfig.provider
      })).filter(provider => this.providers.has(provider.key))
    } else if (defaultModel) {
      // Use single default model
      providers = [{
        key: defaultModel.provider,
        model: defaultModel.model,
        name: defaultModel.name
      }].filter(provider => this.providers.has(provider.key))
    } else {
      throw new Error('No models specified for execution')
    }
    
    if (providers.length === 0) {
      throw new Error('No providers available for multi-command execution')
    }

    // If only one provider, use single execution
    if (providers.length === 1) {
      const startTime = Date.now()
      const result = await this.executeWithProvider(providers[0], providers[0].model, instruction, signal)
      const elapsed = getElapsedTime(startTime)
      
      return {
        results: [result],
        elapsed,
        successful: result.response && !result.error ? 1 : 0,
        total: 1,
        isMultiple: false
      }
    }

    const startTime = Date.now()
    logger.debug(`Starting multi-command execution with ${providers.length} providers`)

    return await this.executeSequentialDisplay(providers, instruction, signal, startTime, onProviderComplete)
  }

  /**
   * Execute multiple providers with real-time streaming - event-driven approach
   */
  async executeSequentialDisplay(providers, instruction, signal, startTime, onProviderComplete) {
    const results = new Array(providers.length)
    let firstModelIndex = -1
    let streamingStarted = false
    const completedCount = { value: 0 }
    const callbackPromises = [] // Track all callback promises
    
    logger.debug(`Starting ${providers.length} models in parallel for real streaming`)
    
    // Start all models in parallel WITHOUT waiting
    const runningExecutions = providers.map(async (provider, index) => {
      try {
        let isStreamingModel = false
        
        const onChunk = (content) => {
          // First model to send chunk becomes streaming model
          if (firstModelIndex === -1 && !streamingStarted) {
            firstModelIndex = index
            isStreamingModel = true
            streamingStarted = true
            
            // Immediately call callback to stop spinner and start streaming
            if (onProviderComplete) {
              const callbackPromise = Promise.resolve(onProviderComplete(null, index, provider, true))
              callbackPromises.push(callbackPromise)
            }
            
            logger.debug(`First model started streaming: ${provider.name} (index: ${index})`)
          }
          
          // Stream content only from first model
          if (isStreamingModel) {
            process.stdout.write(content)
          }
        }
        
        // Execute model with streaming callback
        const result = await this.executeWithStreamingDisplay(
          provider,
          provider.model,
          instruction,
          signal,
          onChunk
        )
        
        results[index] = result
        completedCount.value++
        
        // For non-streaming models, show result immediately when completed
        if (!isStreamingModel && streamingStarted) {
          if (onProviderComplete) {
            const callbackPromise = onProviderComplete(result, index, provider, false)
            callbackPromises.push(callbackPromise)
          }
        }
        
        return { index, result, isStreamingModel }
        
      } catch (error) {
        const errorResult = {
          provider: provider.name,
          model: provider.model,
          response: null,
          error: error.message
        }
        
        results[index] = errorResult
        completedCount.value++
        
        // Show error for non-streaming models
        if (firstModelIndex !== index && streamingStarted) {
          if (onProviderComplete) {
            const callbackPromise = onProviderComplete(errorResult, index, provider, false)
            callbackPromises.push(callbackPromise)
          }
        }
        
        return { index, result: errorResult, isStreamingModel: false }
      }
    })
    
    // Wait for first model to start streaming (polling approach)
    while (firstModelIndex === -1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Check for abort signal
      if (signal && signal.aborted) {
        throw new Error('Streaming cancelled by user')
      }
    }
    
    // Find and wait for streaming model to complete
    const streamingExecution = runningExecutions[firstModelIndex]
    await streamingExecution
    
    // Add newline after streaming model completes
    process.stdout.write('\n')
    
    // Wait for all other models to complete their executions
    await Promise.allSettled(runningExecutions)
    
    // CRITICAL: Wait for ALL callback promises to complete (including typewriter effects)
    if (callbackPromises.length > 0) {
      logger.debug(`Waiting for ${callbackPromises.length} callback promises to complete`)
      await Promise.allSettled(callbackPromises)
      logger.debug('All callback promises completed')
    }
    
    // Fill any missing results
    for (let i = 0; i < providers.length; i++) {
      if (!results[i]) {
        results[i] = {
          provider: providers[i].name,
          model: providers[i].model,
          response: null,
          error: 'Execution failed or timed out'
        }
      }
    }

    const elapsed = getElapsedTime(startTime)
    logger.debug(`Multi-command streaming completed in ${elapsed}s`)

    return {
      results,
      elapsed,
      successful: results.filter(r => r.response && !r.error).length,
      total: providers.length,
      isMultiple: true,
      streamingModelIndex: firstModelIndex
    }
  }

  /**
   * Format multi-command response for display
   */
  formatMultiResponse(result) {
    // Single model result
    if (!result.isMultiple || result.results.length === 1) {
      const execution = result.results[0]
      if (execution.error) {
        return `${color.red}Error: ${execution.error}${color.reset}`
      }
      return execution.response || `${color.yellow}No response${color.reset}`
    }

    // Multiple models result
    let output = ''
    
    for (const execution of result.results) {
      const providerLabel = execution.model 
        ? `${execution.provider} (${execution.model})`
        : execution.provider
      output += `\n${color.cyan}${providerLabel}${color.reset}:\n`
      
      if (execution.error) {
        output += `${color.red}Error: ${execution.error}${color.reset}\n`
      } else if (execution.response) {
        output += `${execution.response}\n`
      } else {
        output += `${color.yellow}No response${color.reset}\n`
      }
    }
    
    // Add summary
    output += `\n${color.grey}[${result.successful}/${result.total} models responded in ${result.elapsed}s]${color.reset}`
    
    return output
  }

  /**
   * Check if provider is available
   */
  isProviderAvailable(providerKey) {
    return this.providers.has(providerKey)
  }

  /**
   * Determine if command should use multiple models
   */
  shouldUseMultipleModels(customModels) {
    return customModels && Array.isArray(customModels) && customModels.length > 1
  }
}

// Export singleton instance
export const multiCommandProcessor = new MultiCommandProcessor()