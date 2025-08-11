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
      
      const finalResponse = response.join('').trim()
      
      return {
        provider: provider.name,
        model: model,
        response: finalResponse,
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
    const completedCount = { value: 0 }
    
    // Leaderboard system for tracking model performance
    const leaderboard = [] // {index, provider, firstChunkTime, status: 'streaming'|'done', displayed: false}
    let currentlyStreaming = null
    let allExecutionsStarted = false
    
    const addToLeaderboard = (index, provider, firstChunkTime) => {
      if (!leaderboard.find(m => m.index === index)) {
        leaderboard.push({
          index,
          provider,
          firstChunkTime,
          status: 'streaming',
          displayed: false,
          fullResponse: '' // Store accumulated response here
        })
        leaderboard.sort((a, b) => a.firstChunkTime - b.firstChunkTime)
        logger.debug(`✅ Added to leaderboard: ${provider.name} (index: ${index}) at ${firstChunkTime - startTime}ms`)
        logger.debug(`📊 Leaderboard state:`, leaderboard.map(m => `${m.provider.name}(${m.index})[${m.status}]`))
      }
    }
    
    const updateModelStatus = (index, status, fullResponse = null) => {
      const model = leaderboard.find(m => m.index === index)
      if (model) {
        const oldStatus = model.status
        model.status = status
        if (fullResponse) {
          model.fullResponse = fullResponse
          logger.debug(`💾 Stored ${fullResponse.length} chars for ${model.provider.name} (index: ${index})`)
        }
        logger.debug(`🔄 Status change: ${model.provider.name} (${index}) ${oldStatus} → ${status}`)
        if (status === 'done') {
          logger.debug(`✅ ${model.provider.name} completed, triggering tryStartNextStream`)
          logger.debug(`📊 Current leaderboard:`, leaderboard.map(m => `${m.provider.name}(${m.index})[${m.status}][displayed:${m.displayed}]`))
          tryStartNextStream()
        }
      } else {
        logger.debug(`❌ Model ${index} not found in leaderboard for status update: ${status}`)
      }
    }
    
    const getNextModelToStream = () => {
      logger.debug(`🔍 Looking for next model to stream...`)
      
      // Priority 1: Find DONE models that haven't been displayed
      const doneModels = leaderboard.filter(m => m.status === 'done' && !m.displayed)
      logger.debug(`📋 Found ${doneModels.length} done undisplayed models:`, doneModels.map(m => `${m.provider.name}(${m.index})`))
      if (doneModels.length > 0) {
        logger.debug(`⭐ Selected DONE model for streaming: ${doneModels[0].provider.name}`)
        return doneModels[0]
      }
      
      // Priority 2: Next in leaderboard that's still streaming
      const streamingModel = leaderboard.find(m => m.status === 'streaming' && !m.displayed)
      if (streamingModel) {
        logger.debug(`⭐ Selected STREAMING model for display: ${streamingModel.provider.name}`)
        return streamingModel
      }
      
      logger.debug(`❌ No models available for streaming`)
      return null
    }
    
    const tryStartNextStream = () => {
      logger.debug(`🚀 tryStartNextStream called`)
      
      if (currentlyStreaming) {
        logger.debug(`⏸️ Already streaming ${currentlyStreaming.provider.name}, skipping`)
        return // Already streaming something
      }
      
      const nextModel = getNextModelToStream()
      if (!nextModel) {
        logger.debug(`⏹️ No models available for streaming`)
        return // No models available
      }
      
      logger.debug(`▶️ Starting stream for ${nextModel.provider.name} (index: ${nextModel.index})`)
      startModelStream(nextModel)
    }
    
    const startModelStream = async (model) => {
      currentlyStreaming = model
      model.displayed = true
      
      logger.debug(`🎬 startModelStream: ${model.provider.name} (index: ${model.index}, status: ${model.status})`)
      
      // Show header and content for this model
      if (onProviderComplete) {
        // Check if this is the first model to stream (index 0 in original providers array)
        const isFirst = model.index === 0
        logger.debug(`📋 Showing header for ${model.provider.name}, isFirst: ${isFirst}`)
        
        // Get current result for fallback
        const result = results[model.index]
        
        // STEP 1: ALWAYS show header FIRST
        if (isFirst) {
          // For first model, show header with null result to indicate streaming (unless already done)
          if (model.status !== 'done') {
            await onProviderComplete(null, model.index, model.provider, true)
          } else {
            // First model is already done, show header with result
            const displayResult = result || {
              provider: model.provider.name,
              model: model.provider.model || 'unknown',
              response: result?.response || '',
              error: result?.error || null
            }
            await onProviderComplete(displayResult, model.index, model.provider, true)
          }
        } else {
          // For non-first models, always show header
          const displayResult = result || {
            provider: model.provider.name,
            model: model.provider.model || 'unknown',
            response: result?.response || '',
            error: result?.error || null
          }
          
          await onProviderComplete(displayResult, model.index, model.provider, false)
        }
        
        // STEP 2: THEN output content for completed models (AFTER header)
        if (model.status === 'done') {
          let contentToOutput = null
          
          // Priority 1: Use accumulated fullResponse
          if (model.fullResponse && model.fullResponse.trim()) {
            contentToOutput = model.fullResponse.trim()
            logger.debug(`✅ Using model.fullResponse for completed model ${model.provider.name} (${contentToOutput.length} chars)`)
          }
          // Priority 2: Fallback to results array
          else if (result && result.response && result.response.trim()) {
            contentToOutput = result.response.trim()
            logger.debug(`🔄 Fallback to results[${model.index}].response for completed model ${model.provider.name} (${contentToOutput.length} chars)`)
          }
          
          if (contentToOutput) {
            logger.debug(`📤 Outputting buffered content for completed model ${model.provider.name}`)
            process.stdout.write(contentToOutput + '\n')
          } else {
            logger.debug(`⚠️ WARNING: No content found for completed model ${model.provider.name}`)
          }
        }
      }
    }
    
    logger.debug(`Starting ${providers.length} models in parallel with leaderboard system`)
    
    // Start all models in parallel WITHOUT waiting
    const runningExecutions = providers.map(async (provider, index) => {
      try {
        let firstChunkSent = false
        let accumulatedResponse = '' // Track full response for this model
        
        const onChunk = (content) => {
          const currentTime = Date.now()
          
          // Accumulate the response for completed models
          accumulatedResponse += content
          
          // Track first chunk for leaderboard
          if (!firstChunkSent) {
            firstChunkSent = true
            addToLeaderboard(index, provider, currentTime)
            
            // Try to start streaming if no model is currently streaming
            if (!currentlyStreaming) {
              tryStartNextStream()
            }
          }
          
          // Update accumulated response in leaderboard (ensure model exists)
          const model = leaderboard.find(m => m.index === index)
          if (model) {
            model.fullResponse = accumulatedResponse
          } else {
            logger.debug(`⚠️ Model ${index} (${provider.name}) not found in leaderboard during chunk processing`)
          }
          
          // Stream content ONLY if this is the currently streaming model
          if (currentlyStreaming?.index === index) {
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
        
        // Mark model as done in leaderboard and handle model completion with accumulated response
        updateModelStatus(index, 'done', accumulatedResponse)
        
        // If this was the streaming model, add newline and prepare for next
        if (currentlyStreaming?.index === index) {
          process.stdout.write('\n')
          currentlyStreaming = null
          logger.debug(`Cleared currentlyStreaming for model ${index}`)
          // Use server-friendly scheduling for next stream
          setImmediate(() => tryStartNextStream())
        }
        
        return { index, result }
        
      } catch (error) {
        const errorResult = {
          provider: provider.name,
          model: provider.model,
          response: null,
          error: error.message
        }
        
        results[index] = errorResult
        completedCount.value++
        
        // Mark model as done (even with error) and handle completion
        updateModelStatus(index, 'done', null)
        
        // If this was the streaming model, add newline and prepare for next
        if (currentlyStreaming?.index === index) {
          process.stdout.write('\n')
          currentlyStreaming = null
          logger.debug(`Cleared currentlyStreaming for model ${index}`)
          // Use server-friendly scheduling for next stream
          setImmediate(() => tryStartNextStream())
        }
        
        return { index, result: errorResult }
      }
    })
    
    // Wait for all executions to complete
    await Promise.allSettled(runningExecutions)
    allExecutionsStarted = true
    
    logger.debug(`All model executions completed with leaderboard system`)
    
    // Final check: Ensure all models have been processed through the leaderboard
    const undisplayedModels = leaderboard.filter(m => !m.displayed)
    logger.debug(`🔍 Final cleanup: ${undisplayedModels.length} models still undisplayed:`, undisplayedModels.map(m => `${m.provider.name}(${m.index})[${m.status}]`))
    
    while (leaderboard.some(m => !m.displayed)) {
      const undisplayedModel = leaderboard.find(m => !m.displayed)
      if (undisplayedModel) {
        logger.debug(`🛠️ Processing remaining model: ${undisplayedModel.provider.name} (${undisplayedModel.index}) [${undisplayedModel.status}]`)
        logger.debug(`📝 fullResponse length: ${undisplayedModel.fullResponse?.length || 0}`)
        logger.debug(`📝 results[${undisplayedModel.index}] response length: ${results[undisplayedModel.index]?.response?.length || 0}`)
        
        // Reset currentlyStreaming to null for final cleanup
        currentlyStreaming = null
        await startModelStream(undisplayedModel)
      } else {
        logger.debug(`❌ No undisplayed model found, breaking loop`)
        break
      }
    }
    
    logger.debug(`✅ All models processed. Final leaderboard:`, leaderboard.map(m => `${m.provider.name}(${m.index})[${m.status}][displayed:${m.displayed}]`))
    
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
    logger.debug(`Multi-command leaderboard streaming completed in ${elapsed}s`)

    return {
      results,
      elapsed,
      successful: results.filter(r => r && r.response && r.response.trim() && !r.error).length,
      total: providers.length,
      isMultiple: true,
      streamingModelIndex: leaderboard.length > 0 ? leaderboard[0].index : -1
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