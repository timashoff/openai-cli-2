import { color } from '../config/color.js'
import { createProvider } from './provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { logger } from './logger.js'
import { getElapsedTime, clearTerminalLine } from './index.js'
import { StreamProcessor } from './stream-processor.js'
import { UI_SYMBOLS } from '../config/constants.js'
import { configManager } from '../config/config-manager.js'
import { streamingObserver, STREAMING_EVENTS } from '../patterns/StreamingObserver.js'

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

    // Start streaming observer for event tracking
    streamingObserver.startObserving({ 
      trackMetrics: true, 
      debug: logger.level === 'debug' 
    })

    // Critical check: ensure MultiCommandProcessor is initialized
    if (!this.isInitialized) {
      logger.error(`🚨 CRITICAL: MultiCommandProcessor not initialized!`)
      throw new Error('MultiCommandProcessor not initialized. Call initialize() first.')
    }

    if (this.providers.size === 0) {
      logger.error(`🚨 CRITICAL: No providers available in MultiCommandProcessor!`)
      throw new Error('No providers initialized in MultiCommandProcessor.')
    }

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
      
      // Stop observer for single execution
      streamingObserver.stopObserving()
      
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

    try {
      return await this.executeSequentialDisplay(providers, instruction, signal, startTime, onProviderComplete)
    } catch (error) {
      // Ensure observer is stopped even on error
      streamingObserver.stopObserving()
      throw error
    }
  }

  /**
   * Execute multiple providers with real-time streaming - event-driven approach
   */
  async executeSequentialDisplay(providers, instruction, signal, startTime, onProviderComplete) {
    const results = new Array(providers.length)
    const completedCount = { value: 0 }
    
    // State for spinner and first chunk tracking
    let firstChunkReceived = false
    
    // Start initial spinner
    this.startSpinner(startTime)
    
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
        
        // Emit leaderboard updated event
        streamingObserver.emit(STREAMING_EVENTS.MULTI_LEADERBOARD_UPDATED, {
          leaderboard: leaderboard.map(m => ({ 
            provider: m.provider.name, 
            status: m.status, 
            latency: m.firstChunkTime - startTime 
          })),
          newLeader: leaderboard[0] ? {
            provider: leaderboard[0].provider.name,
            latency: leaderboard[0].firstChunkTime - startTime
          } : null,
          addedModel: {
            provider: provider.name,
            index,
            latency: firstChunkTime - startTime
          }
        })
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
      
      // Stop inter-model spinner when starting next model
      this.stopSpinner()
      
      logger.debug(`🎬 startModelStream: ${model.provider.name} (index: ${model.index}, status: ${model.status})`)
      
      // Show header for this model (only for non-streaming models)
      if (model.status === 'done') {
        logger.debug(`📋 Showing header for completed model: ${model.provider.name} (index: ${model.index})`)
        logger.debug(`📋 Provider data:`, { key: model.provider.key, name: model.provider.name, model: model.provider.model })
        
        const providerLabel = model.provider.model 
          ? `${model.provider.name} (${model.provider.model})`
          : model.provider.name
        console.log(`${color.cyan}${providerLabel}:${color.reset}`)
        
        // Output content for completed models (AFTER header)
        let contentToOutput = null
        
        // Priority 1: Use accumulated fullResponse
        if (model.fullResponse && model.fullResponse.trim()) {
          contentToOutput = model.fullResponse.trim()
          logger.debug(`✅ Using model.fullResponse for completed model ${model.provider.name} (${contentToOutput.length} chars)`)
        }
        // Priority 2: Fallback to results array
        else if (results[model.index] && results[model.index].response && results[model.index].response.trim()) {
          contentToOutput = results[model.index].response.trim()
          logger.debug(`🔄 Fallback to results[${model.index}].response for completed model ${model.provider.name} (${contentToOutput.length} chars)`)
        }
        
        if (contentToOutput) {
          logger.debug(`📤 Outputting buffered content for completed model ${model.provider.name}`)
          process.stdout.write(contentToOutput + '\n')
          
          // Add timer for completed model (estimate completion time from results)
          const result = results[model.index]
          if (result) {
            const modelElapsed = getElapsedTime(startTime)
            process.stdout.write(`${color.green}✓ ${modelElapsed}s${color.reset}\n\n`)
          }
        } else {
          logger.debug(`⚠️ WARNING: No content found for completed model ${model.provider.name}`)
          // Still show timer even if no content
          const modelElapsed = getElapsedTime(startTime)
          process.stdout.write(`${color.red}✗ ${modelElapsed}s (no content)${color.reset}\n\n`)
        }
      }
    }
    
    logger.debug(`Starting ${providers.length} models in parallel with leaderboard system`)
    
    // Emit multi-stream started event
    streamingObserver.emit(STREAMING_EVENTS.MULTI_STREAM_STARTED, {
      totalModels: providers.length,
      models: providers.map(p => ({ provider: p.name, model: p.model })),
      instruction: instruction.substring(0, 100) + (instruction.length > 100 ? '...' : '')
    })
    
    // Start all models in parallel WITHOUT waiting
    const runningExecutions = providers.map(async (provider, index) => {
      try {
        let firstChunkSent = false
        let accumulatedResponse = '' // Track full response for this model
        
        // Add model to leaderboard immediately when starting execution
        // This ensures all models are tracked, even if they don't send chunks
        const modelInLeaderboard = leaderboard.find(m => m.index === index)
        if (!modelInLeaderboard) {
          leaderboard.push({
            index,
            provider,
            firstChunkTime: Date.now(), // Will be updated when first chunk arrives
            status: 'streaming',
            displayed: false,
            fullResponse: ''
          })
          logger.debug(`🚀 Pre-added to leaderboard: ${provider.name} (index: ${index})`)
        }
        
        const onChunk = (content) => {
          const currentTime = Date.now()
          
          // Accumulate the response for completed models
          accumulatedResponse += content
          
          // Track first chunk for leaderboard
          if (!firstChunkSent) {
            firstChunkSent = true
            
            // Emit first chunk event
            streamingObserver.emit(STREAMING_EVENTS.FIRST_CHUNK, {
              modelIndex: index,
              provider: provider.name,
              model: provider.model,
              latency: currentTime - startTime,
              contentPreview: content.substring(0, 50)
            })
            
            // Update firstChunkTime for existing leaderboard entry
            const existingModel = leaderboard.find(m => m.index === index)
            if (existingModel) {
              existingModel.firstChunkTime = currentTime
              leaderboard.sort((a, b) => a.firstChunkTime - b.firstChunkTime)
              logger.debug(`⏰ Updated firstChunkTime for ${provider.name} (index: ${index}) at ${currentTime - startTime}ms`)
            } else {
              // Fallback: add to leaderboard if not already there
              addToLeaderboard(index, provider, currentTime)
            }
            
            // Start streaming immediately if no model is currently streaming
            if (!currentlyStreaming) {
              // Stop spinner and start streaming this model immediately
              firstChunkReceived = true
              this.stopSpinner()
              currentlyStreaming = existingModel || leaderboard.find(m => m.index === index)
              
              // CRITICAL FIX: Mark as displayed to prevent duplicate processing in final cleanup
              if (currentlyStreaming) {
                currentlyStreaming.displayed = true
                logger.debug(`Fixed duplicate bug: Marked first streaming model as displayed: ${currentlyStreaming.provider.name} (index: ${currentlyStreaming.index})`)
              }
              
              // Show header for this model
              logger.debug(`📋 Showing header for first streaming model: ${provider.name} (index: ${index})`)
              logger.debug(`📋 Provider data:`, { key: provider.key, name: provider.name, model: provider.model })
              
              const providerLabel = provider.model 
                ? `${provider.name} (${provider.model})`
                : provider.name
              console.log(`${color.cyan}${providerLabel}:${color.reset}`)
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
          
          // Emit chunk received event
          streamingObserver.emit(STREAMING_EVENTS.CHUNK_RECEIVED, {
            modelIndex: index,
            provider: provider.name,
            content: content,
            chunkSize: content.length,
            totalSize: accumulatedResponse.length,
            isCurrentlyStreaming: currentlyStreaming?.index === index
          })
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
        
        // Emit model completed event
        streamingObserver.emit(STREAMING_EVENTS.MODEL_COMPLETED, {
          modelIndex: index,
          provider: provider.name,
          model: provider.model,
          success: !result.error,
          error: result.error,
          responseLength: accumulatedResponse.length,
          duration: Date.now() - startTime
        })
        
        // Mark model as done in leaderboard and handle model completion with accumulated response
        updateModelStatus(index, 'done', accumulatedResponse)
        
        // If this was the streaming model, add newline and timer, then prepare for next
        if (currentlyStreaming?.index === index) {
          const modelElapsed = getElapsedTime(startTime)
          process.stdout.write(`\n${color.green}✓ ${modelElapsed}s${color.reset}\n\n`)
          currentlyStreaming = null
          logger.debug(`Cleared currentlyStreaming for model ${index}`)
          
          // Check if there are more models waiting and start inter-model spinner
          const pendingModels = leaderboard.filter(m => !m.displayed && m.status === 'streaming')
          if (pendingModels.length > 0) {
            this.startSpinner(startTime)
          }
          
          // Start next stream immediately
          tryStartNextStream()
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
        
        // If this was the streaming model, add newline and error indicator, then prepare for next
        if (currentlyStreaming?.index === index) {
          const modelElapsed = getElapsedTime(startTime)
          process.stdout.write(`\n${color.red}✗ ${modelElapsed}s (error)${color.reset}\n\n`)
          currentlyStreaming = null
          logger.debug(`Cleared currentlyStreaming for model ${index}`)
          // Start next stream immediately
          tryStartNextStream()
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
    logger.debug(`🔍 Final cleanup: ${undisplayedModels.length} models still undisplayed:`, undisplayedModels.map(m => `${m.provider.name}(${m.index})[${m.status}][displayed:${m.displayed}]`))
    
    while (leaderboard.some(m => !m.displayed)) {
      const undisplayedModel = leaderboard.find(m => !m.displayed)
      if (undisplayedModel) {
        logger.debug(`🛠️ Processing remaining model: ${undisplayedModel.provider.name} (${undisplayedModel.index}) [${undisplayedModel.status}][displayed:${undisplayedModel.displayed}]`)
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

    // Ensure spinner is stopped at the end
    this.stopSpinner()

    // Output final summary
    const successful = results.filter(r => r && r.response && r.response.trim() && !r.error).length
    process.stdout.write(`${color.grey}[${successful}/${providers.length} models responded in ${elapsed}s]${color.reset}\n`)

    // Emit multi-stream finished event
    streamingObserver.emit(STREAMING_EVENTS.MULTI_STREAM_FINISHED, {
      totalModels: providers.length,
      successfulModels: successful,
      failedModels: providers.length - successful,
      totalDuration: elapsed,
      leaderboard: leaderboard.map(m => ({
        provider: m.provider.name,
        status: m.status,
        responseLength: m.fullResponse?.length || 0,
        latency: m.firstChunkTime - startTime
      }))
    })

    // Stop observer after multi-stream completion
    streamingObserver.stopObserving()

    return {
      results,
      elapsed,
      successful,
      total: providers.length,
      isMultiple: true,
      streamingModelIndex: leaderboard.length > 0 ? leaderboard[0].index : -1
    }
  }

  /**
   * Format multi-command response for display
   */
  formatMultiResponse(result, commandKey = null) {
    // Single model result
    if (!result.isMultiple || result.results.length === 1) {
      const execution = result.results[0]
      if (execution.error) {
        return `${color.red}Error: ${execution.error}${color.reset}`
      }
      return execution.response || `${color.yellow}No response${color.reset}`
    }

    // Multiple models result - include handler info at the beginning
    let output = commandKey ? `[Handler: ${commandKey}]\n\n` : ''
    
    // Sort results by leaderboard order (firstChunkTime) if available
    let sortedResults = [...result.results]
    if (result.streamingModelIndex !== undefined && result.streamingModelIndex >= 0) {
      // Sort with streaming model first, then by original order
      sortedResults = result.results.slice().sort((a, b) => {
        // If we have the streaming model index, put it first
        if (a === result.results[result.streamingModelIndex]) return -1
        if (b === result.results[result.streamingModelIndex]) return 1
        // Otherwise maintain original order
        return result.results.indexOf(a) - result.results.indexOf(b)
      })
    }
    
    for (const execution of sortedResults) {
      const providerLabel = execution.model 
        ? `${execution.provider} (${execution.model})`
        : execution.provider
      output += `${color.cyan}${providerLabel}${color.reset}:\n`
      
      if (execution.error) {
        output += `${color.red}Error: ${execution.error}${color.reset}\n`
      } else if (execution.response) {
        output += `${execution.response}\n`
      } else {
        output += `${color.yellow}No response${color.reset}\n`
      }
      
      // Add timer for each model (will be replaced with real timing in streaming mode)
      output += `${color.green}✓ formatted${color.reset}\n\n`
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
  
  /**
   * Start spinner for waiting periods
   */
  startSpinner(startTime) {
    if (this.spinnerInterval) return
    
    let i = 0
    process.stdout.write('\x1B[?25l') // Hide cursor
    this.spinnerInterval = setInterval(() => {
      clearTerminalLine()
      const elapsedTime = getElapsedTime(startTime)
      process.stdout.write(
        `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
      )
    }, configManager.get('spinnerInterval'))
    this.isShowingSpinner = true
  }
  
  /**
   * Stop spinner
   */
  stopSpinner() {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = null
      clearTerminalLine()
      process.stdout.write('\x1B[?25h') // Show cursor
      this.isShowingSpinner = false
    }
  }
}

// Export singleton instance
export const multiCommandProcessor = new MultiCommandProcessor()