import { BaseRequestHandler } from './base-handler.js'
import { createBaseError } from '../core/error-system/index.js'
import { color } from '../config/color.js'
import { getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import cacheManager from '../core/CacheManager.js'
import { outputHandler } from '../core/output-handler.js'

/**
 * Handler for AI streaming operations and final request processing
 * This is typically the last handler in the chain that processes AI requests
 */
export class StreamHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.streamingService = dependencies.streamingService
    /** @type {Object} */
    this.providerService = dependencies.providerService
    /** @type {Object} */
    this.cache = dependencies.cache
    /** @type {Object} */
    this.multiCommandProcessor = dependencies.multiCommandProcessor
    /** @type {Object} */
    this.fileManager = dependencies.fileManager
    /** @type {Map<string, number>} */
    this.streamStats = new Map()
    /** @type {Date} */
    this.lastStreamOperation = null
  }

  /**
   * Stream handler can handle any remaining input that wasn't processed by previous handlers
   */
  async canHandle(context) {
    return true // Final handler - accepts all remaining requests
  }

  /**
   */
  async process(context) {
    try {
      this.log('info', 'Processing AI request through streaming handler')
      
      // Determine processing strategy based on context
      const strategy = this.determineProcessingStrategy(context)
      
      // Process according to strategy
      const result = await this.processWithStrategy(context, strategy)
      
      // Update statistics
      this.updateStreamStats(strategy, true)
      this.lastStreamOperation = new Date()
      
      // Emit processing event
      this.emitEvent('stream:processed', {
        strategy,
        success: true,
        inputLength: context.processedInput.length
      })
      
      return result
      
    } catch (error) {
      this.log('error', `Stream processing failed: ${error.message}`)
      
      // Update error statistics
      this.updateStreamStats('error', false, error.message)
      
      // Emit error event
      this.emitEvent('stream:error', {
        error: error.message,
        input: context.processedInput ? context.processedInput.substring(0, 100) : 'unknown'
      })
      
      // Handle different error types
      return this.handleStreamError(error, context)
    }
  }

  /**
   * Determine processing strategy based on context


   */
  determineProcessingStrategy(context) {
    const instruction = context.instructionInfo
    const command = context.command
    
    // Check for Mixed mode data from RequestRouter or Cache Handler
    const uncachedModels = context.uncachedModels || context.routingResult?.uncachedModels
    const cachedCount = context.cachedCount
    
    // Multi-model streaming - check uncached models from cache handler
    if (uncachedModels && Array.isArray(uncachedModels) && uncachedModels.length > 1) {
      return 'multi-command-uncached' // Only uncached models
    }
    
    // Single uncached model from multi-model command
    if (uncachedModels && Array.isArray(uncachedModels) && uncachedModels.length === 1) {
      return 'single-stream-uncached' // Single uncached model with context about cached ones
    }
    
    // Multi-model streaming (universal multi-command support) - fallback
    if (command?.models && Array.isArray(command.models) && command.models.length > 1) {
      return 'multi-command'
    }
    
    // Multi-provider translation (but not multi-model)
    if (instruction?.isMultiProvider && 
        !(instruction.models && Array.isArray(instruction.models) && instruction.models.length > 1)) {
      return 'multi-provider'
    }
    
    // Document translation
    if (instruction?.isDocCommand) {
      return 'document'
    }
    
    // Regular single-provider streaming
    return 'single-stream'
  }

  /**
   * Process request with determined strategy



   */
  async processWithStrategy(context, strategy) {
    switch (strategy) {
      case 'multi-command-uncached':
        return await this.processMultiCommandUncached(context)
        
      case 'single-stream-uncached':
        return await this.processSingleStreamUncached(context)
        
      case 'multi-command':
        return await this.processMultiCommand(context)
        
      case 'multi-provider':
        return await this.processMultiProvider(context)
        
      case 'document':
        return await this.processDocument(context)
        
      case 'single-stream':
        return await this.processSingleStream(context)
        
      default:
        throw createBaseError(`Unknown processing strategy: ${strategy}`, true, 500)
    }
  }

  /**
   * Process multi-command request (multiple models)


   */
  async processMultiCommand(context) {
    if (!this.multiCommandProcessor) {
      throw createBaseError('Multi-command processor not available', true, 503)
    }
    
    const instruction = context.instructionInfo
    const models = instruction.models
    
    this.log('info', `Processing multi-command with ${models.length} models`)
    
    try {
      let displayedCount = 0
      const startTime = Date.now()
      
      // Callback for handling each provider completion
      const onProviderComplete = async (result, index, provider, isFirst) => {
        if (isFirst) {
          // First model - show header and prepare for streaming
          const finalTime = getElapsedTime(startTime)
          showStatus('success', finalTime)
          
          const providerLabel = provider.model ? 
            `${provider.name} (${provider.model})` : 
            provider.name
          outputHandler.write(`\n${color.cyan}${providerLabel}${color.reset}:`)
          
          return
        }
        
        // Handle non-first models
        if (result) {
          displayedCount++
          
          const providerLabel = result.model ? 
            `${result.provider} (${result.model})` : 
            result.provider
          outputHandler.write(`\n${color.cyan}${providerLabel}${color.reset}:`)
          
          if (result.error) {
            outputHandler.writeError(`Error: ${result.error}`)
          }
        }
      }
      
      // Execute multi-command processing
      const result = await this.multiCommandProcessor.executeMultiple({
        instruction: instruction.content,
        signal: context.abortController.signal,
        models: models,
        defaultModel: null,
        onComplete: onProviderComplete
      })
      
      // Add summary if multiple providers
      if (result.results.length > 1) {
        outputHandler.write(`\n${color.grey}[${result.successful}/${result.total} models responded in ${result.elapsed}s]${color.reset}`)
      }
      
      // Cache the responses if cache info available
      if (context.cacheInfo?.shouldCache && this.cache) {
        await this.cacheMultiCommandResponse(context, result.results)
      }
      
      return this.createResult(result.results, { 
        stopChain: true,
        metadata: {
          strategy: 'multi-command',
          modelCount: result.total,
          successfulModels: result.successful
        }
      })
      
    } catch (error) {
      // Handle multi-command specific errors
      if (this.isAbortError(error)) {
        this.log('info', 'Multi-command processing aborted by user')
        return this.createResult([], { stopChain: true })
      }
      throw error
    }
  }

  /**
   * Process multi-provider request


   */
  async processMultiProvider(context) {
    if (!this.multiCommandProcessor) {
      throw createBaseError('Multi-command processor not available', true, 503)
    }
    
    const instruction = context.instructionInfo
    
    this.log('info', `Processing multi-provider request: ${instruction.commandType}`)
    
    try {
      const result = await this.multiCommandProcessor.executeMultiple({
        instruction: instruction.content,
        signal: context.abortController.signal,
        models: instruction.models,
        defaultModel: null,
        onComplete: null
      })
      
      const formattedResponse = this.multiCommandProcessor.formatMultiResponse(result)
      outputHandler.write(formattedResponse)
      
      // Cache the responses if cache info available
      if (context.cacheInfo?.shouldCache && this.cache) {
        await this.cacheMultiCommandResponse(context, result.results)
      }
      
      return this.createResult(result.results, { 
        stopChain: true,
        metadata: {
          strategy: 'multi-provider',
          modelCount: result.total,
          successfulModels: result.successful
        }
      })
      
    } catch (error) {
      if (this.isAbortError(error)) {
        this.log('info', 'Multi-provider processing aborted by user')
        return this.createResult([], { stopChain: true })
      }
      throw error
    }
  }

  /**
   * Process document translation request


   */
  async processDocument(context) {
    if (!this.multiCommandProcessor || !this.fileManager) {
      throw createBaseError('Document processing services not available', true, 503)
    }
    
    const instruction = context.instructionInfo
    
    this.log('info', `Processing document translation: ${instruction.commandKey}`)
    
    try {
      const result = await this.multiCommandProcessor.executeMultiple({
        instruction: instruction.content,
        signal: context.abortController.signal,
        models: instruction.models || [],
        defaultModel: null,
        onComplete: null
      })
      
      if (result.results?.length > 0) {
        const formattedResponse = this.multiCommandProcessor.formatMultiResponse(result)
        outputHandler.write(formattedResponse)
        
        // Save to file
        const fileInfo = await this.fileManager.saveDocumentTranslation(
          formattedResponse,
          instruction.userInput,
          { 
            command: instruction.commandKey, 
            timestamp: new Date().toISOString() 
          }
        )
        
        // Show success message
        this.fileManager.showSaveSuccess(fileInfo)
        
        // Cache document if cache info available
        if (context.cacheInfo?.shouldCache && this.cache) {
          await this.cacheDocumentResponse(context, fileInfo, result.result.response)
        }
        
        return this.createResult(result.result.response, { 
          stopChain: true,
          metadata: {
            strategy: 'document',
            fileInfo
          }
        })
      } else {
        outputHandler.writeError('Document translation failed')
        return this.createResult(null, { stopChain: true })
      }
      
    } catch (error) {
      if (this.isAbortError(error)) {
        this.log('info', 'Document processing aborted by user')
        return this.createResult(null, { stopChain: true })
      }
      throw error
    }
  }

  /**
   * Process single stream request


   */
  async processSingleStream(context) {
    if (!this.providerService || !this.streamingService) {
      throw createBaseError('Streaming services not available', true, 503)
    }
    
    this.log('info', 'Processing single stream request')
    
    try {
      // Get current provider
      const currentProvider = this.providerService.getCurrentProvider()
      if (!currentProvider || !currentProvider.provider) {
        throw createBaseError('No AI provider available', true, 503)
      }
      
      // Prepare messages
      const messages = this.prepareMessages(context)
      
      // Get stream from provider
      const stream = await currentProvider.provider.createChatCompletion(
        currentProvider.model,
        messages,
        {
          stream: true,
          signal: context.abortController.signal
        }
      )
      
      // Process stream
      const response = await this.streamingService.startStream({
        stream,
        providerKey: currentProvider.key,
        model: currentProvider.model,
        onChunk: (chunk) => {
          if (!context.abortController.signal.aborted) {
            outputHandler.writeStream(chunk)
          }
        },
        signal: context.abortController.signal
      })
      
      // Handle context and caching
      const fullResponse = response.join('')
      await this.handleSingleStreamResponse(context, fullResponse, messages)
      
      return this.createResult(fullResponse, { 
        stopChain: true,
        metadata: {
          strategy: 'single-stream',
          provider: currentProvider.key,
          model: currentProvider.model,
          responseLength: fullResponse.length
        }
      })
      
    } catch (error) {
      if (this.isAbortError(error)) {
        this.log('info', 'Single stream processing aborted by user')
        return this.createResult('', { stopChain: true })
      }
      
      // Handle provider-specific errors (e.g., region blocking)
      if (this.isProviderError(error)) {
        return await this.handleProviderError(error, context)
      }
      
      throw error
    }
  }

  /**
   * Prepare messages for AI request


   */
  prepareMessages(context) {
    const instruction = context.instructionInfo
    
    if (instruction?.isTranslation) {
      // Translation requests use single message
      return [{ role: 'user', content: context.processedInput }]
    } else {
      // Chat requests use context history
      const contextHistory = context.services.contextHistory || []
      const messages = contextHistory.map(({ role, content }) => ({ role, content }))
      messages.push({ role: 'user', content: context.processedInput })
      return messages
    }
  }

  /**
   * Handle single stream response (caching and context)



   */
  async handleSingleStreamResponse(context, response, messages) {
    const instruction = context.instructionInfo
    
    // Use CacheManager for caching decision
    const shouldCache = cacheManager.shouldCache(context.command, instruction, false)
    
    if (shouldCache && context.cacheInfo?.shouldCache) {
      await this.cacheSingleResponse(context, response, true)
    } else {
      // Add to context history for chat
      if (context.services.addToContext) {
        context.services.addToContext('user', context.processedInput)
        context.services.addToContext('assistant', response)
        
        // Show context dots
        const historyLength = context.services.contextHistory?.length || 0
        const historyDots = '.'.repeat(historyLength)
        outputHandler.write('\n' + color.yellow + historyDots + color.reset)
      }
    }
  }

  /**
   * Cache single response
   */
  async cacheSingleResponse(context, response) {
    await cacheManager.setCache(context.cacheInfo.key, response, true)
  }

  /**
   * Cache multi-provider response
   */
  async cacheMultiProviderResponse(context, responses) {
    await cacheManager.setMultipleResponses(context.cacheInfo.key, responses, true)
  }

  /**
   * Cache multi-command response
   */
  async cacheMultiCommandResponse(context, responses) {
    const formattedResponses = responses.map(r => ({
      provider: r.provider,
      model: r.model,
      response: r.response,
      error: r.error
    }))
    await cacheManager.setMultipleResponses(context.cacheInfo.key, formattedResponses, true)
  }

  /**
   * Cache document response
   */
  async cacheDocumentResponse(context, fileInfo, response) {
    if (this.cache?.setDocumentFile) {
      await this.cache.setDocumentFile(context.cacheInfo.key, fileInfo, response)
    }
  }

  /**
   * Handle stream processing errors



   */
  handleStreamError(error, context) {
    if (this.isAbortError(error)) {
      // User cancellation - not really an error
      return this.createResult(null, { stopChain: true })
    }
    
    // Show user-friendly error
    outputHandler.writeError(`AI processing error: ${this.getUserFriendlyError(error)}`)
    
    return this.createResult(null, { 
      stopChain: true,
      metadata: { error: error.message }
    })
  }

  /**
   * Handle provider-specific errors



   */
  async handleProviderError(error, context) {
    if (error.message.includes('403') && error.message.includes('Country, region, or territory not supported')) {
      outputHandler.writeWarning('Region blocked. Trying alternative provider...')
      
      // Try alternative provider
      if (this.providerService.tryAlternativeProvider) {
        try {
          const alternative = await this.providerService.tryAlternativeProvider()
          if (alternative) {
            // Retry with new provider
            return await this.processSingleStream(context)
          }
        } catch (retryError) {
          outputHandler.writeError('All providers failed.')
        }
      }
    }
    
    throw error // Re-throw if can't handle
  }

  /**
   * Check if error is an abort error


   */
  isAbortError(error) {
    return error.name === 'AbortError' || 
           error.message === 'AbortError' ||
           error.message.includes('aborted') ||
           error.message.includes('cancelled')
  }

  /**
   * Check if error is a provider error that can be handled


   */
  isProviderError(error) {
    return error.message.includes('403') && 
           error.message.includes('Country, region, or territory not supported')
  }

  /**
   * Convert technical errors to user-friendly messages


   */
  getUserFriendlyError(error) {
    if (error.message.includes('timeout')) {
      return 'Request timed out. Please try again.'
    }
    
    if (error.message.includes('No AI provider available')) {
      return 'AI service is not available. Please check your configuration.'
    }
    
    if (error.message.includes('network') || error.message.includes('fetch failed')) {
      return 'Network error. Please check your connection and try again.'
    }
    
    if (error.message.includes('403')) {
      return 'Access denied. Please check your API key and permissions.'
    }
    
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return 'Rate limit exceeded. Please wait a moment and try again.'
    }
    
    // Default fallback
    return 'Unable to process request. Please try again.'
  }

  /**
   * Update stream statistics



   */
  updateStreamStats(strategy, success, error = null) {
    const key = success ? strategy : `${strategy}:error`
    const current = this.streamStats.get(key) || {
      count: 0,
      lastOperation: null,
      errors: []
    }
    
    current.count++
    current.lastOperation = new Date()
    
    if (!success && error && current.errors.length < 3) {
      current.errors.push({
        error,
        timestamp: new Date()
      })
    }
    
    this.streamStats.set(key, current)
  }

  /**
   */
  getStats() {
    const baseStats = super.getStats()
    
    const streamStats = {
      totalOperations: 0,
      successful: 0,
      errors: 0,
      lastOperation: this.lastStreamOperation,
      strategyBreakdown: {}
    }
    
    for (const [key, data] of this.streamStats) {
      if (key.includes(':error')) {
        streamStats.errors += data.count
      } else {
        streamStats.successful += data.count
      }
      
      streamStats.totalOperations += data.count
      streamStats.strategyBreakdown[key] = { ...data }
    }
    
    streamStats.successRate = streamStats.totalOperations > 0 ? 
      (streamStats.successful / streamStats.totalOperations) * 100 : 0
    
    return {
      ...baseStats,
      streamOperations: streamStats
    }
  }

  /**
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    const stats = this.getStats().streamOperations
    
    return {
      ...baseHealth,
      streamHealth: {
        hasStreamingService: !!this.streamingService,
        hasProviderService: !!this.providerService,
        totalOperations: stats.totalOperations,
        successRate: stats.successRate,
        recentErrors: stats.errors,
        lastOperation: this.lastStreamOperation,
        isHealthy: this.streamingService && this.providerService && stats.successRate > 80
      }
    }
  }

  /**
   * Process multi-command request with only live models (Mixed режим)


   */
  async processMultiCommandUncached(context) {
    if (!this.multiCommandProcessor) {
      throw createBaseError('Multi-command processor not available', true, 503)
    }
    
    const uncachedModels = context.uncachedModels || context.routingResult?.uncachedModels
    const cachedCount = context.cachedCount || 0
    
    this.log('info', `Processing ${uncachedModels.length} uncached models (${cachedCount} already from cache)`)
    
    try {
      // Create modified command with only uncached models
      const uncachedCommand = {
        ...context.command,
        models: uncachedModels
      }
      
      const startTime = Date.now()
      
      // Process uncached models through multiCommandProcessor
      const result = await this.multiCommandProcessor.process(uncachedCommand)
      
      // Auto-save each uncached response to per-model cache
      if (result.results && cacheManager.shouldCache(context.command)) {
        for (const response of result.results) {
          if (response.response && !response.error) {
            await cacheManager.setCacheByModel(
              context.processedInput,
              context.command.id,
              response.model,
              response.response
            )
            
            this.log('debug', `Cached response for model: ${response.model}`)
          }
        }
      }
      
      // Show final statistics with mixed count
      const totalTime = Date.now() - startTime
      const successfulUncached = result.results.filter(r => r.response && !r.error).length
      const totalModels = uncachedModels.length + cachedCount
      
      outputHandler.writeNewline()
      outputHandler.write(`[${totalModels} models responded - ${cachedCount} from cache, ${successfulUncached} live in ${(totalTime/1000).toFixed(1)}s]`)
      
      return this.createResult(result.results, { 
        stopChain: true,
        metadata: {
          totalModels,
          cachedModels: cachedCount,
          liveModels: successfulLive,
          mixedMode: true
        }
      })
      
    } catch (error) {
      this.log('error', `Multi-command live processing failed: ${error.message}`)
      throw error
    }
  }
  
  /**
   * Process single live model from multi-model command


   */
  async processSingleStreamUncached(context) {
    const uncachedModels = context.uncachedModels || context.routingResult?.uncachedModels
    const uncachedModel = uncachedModels[0]
    const cachedCount = context.cachedCount || 0
    
    this.log('info', `Processing single uncached model: ${uncachedModel} (${cachedCount} already from cache)`)
    
    try {
      // Create single-model command
      const singleCommand = {
        ...context.command,
        models: [uncachedModel]
      }
      
      const startTime = Date.now()
      
      // Process through regular single stream
      const result = await this.processSingleStream({
        ...context,
        command: singleCommand
      })
      
      // Auto-save response to per-model cache
      if (result.result && cacheManager.shouldCache(context.command)) {
        await cacheManager.setCacheByModel(
          context.processedInput,
          context.command.id,
          uncachedModel,
          result.result
        )
        
        this.log('debug', `Cached response for model: ${uncachedModel}`)
      }
      
      // Show final statistics
      const totalTime = Date.now() - startTime
      const totalModels = 1 + cachedCount
      
      outputHandler.writeNewline()
      outputHandler.write(`[${totalModels} models responded - ${cachedCount} from cache, 1 live in ${(totalTime/1000).toFixed(1)}s]`)
      
      return this.createResult(result.result, {
        stopChain: true,
        metadata: {
          totalModels,
          cachedModels: cachedCount,
          uncachedModels: 1,
          mixedMode: true
        }
      })
      
    } catch (error) {
      this.log('error', `Single stream live processing failed: ${error.message}`)
      throw error
    }
  }

  /**
   */
  dispose() {
    super.dispose()
    this.streamStats.clear()
    this.lastStreamOperation = null
  }
}