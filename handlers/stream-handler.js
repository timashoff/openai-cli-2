import { BaseRequestHandler } from './base-handler.js'
import { AppError } from '../utils/error-handler.js'
import { color } from '../config/color.js'
import { getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'

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
    this.multiProviderTranslator = dependencies.multiProviderTranslator
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
   * @override
   * Stream handler can handle any remaining input that wasn't processed by previous handlers
   */
  async canHandle(context) {
    return true // Final handler - accepts all remaining requests
  }

  /**
   * @override
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
        input: context.processedInput.substring(0, 100)
      })
      
      // Handle different error types
      return this.handleStreamError(error, context)
    }
  }

  /**
   * Determine processing strategy based on context
   * @private
   * @param {Object} context - Processing context
   * @returns {string} Processing strategy
   */
  determineProcessingStrategy(context) {
    const instruction = context.instructionInfo
    const command = context.command
    
    // Multi-model streaming (universal multi-command support)
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
   * @private
   * @param {Object} context - Processing context
   * @param {string} strategy - Processing strategy
   * @returns {Promise<Object>} Processing result
   */
  async processWithStrategy(context, strategy) {
    switch (strategy) {
      case 'multi-command':
        return await this.processMultiCommand(context)
        
      case 'multi-provider':
        return await this.processMultiProvider(context)
        
      case 'document':
        return await this.processDocument(context)
        
      case 'single-stream':
        return await this.processSingleStream(context)
        
      default:
        throw new AppError(`Unknown processing strategy: ${strategy}`, true, 500)
    }
  }

  /**
   * Process multi-command request (multiple models)
   * @private
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processMultiCommand(context) {
    if (!this.multiCommandProcessor) {
      throw new AppError('Multi-command processor not available', true, 503)
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
          process.stdout.write(`\n${color.cyan}${providerLabel}${color.reset}:\n`)
          
          return
        }
        
        // Handle non-first models
        if (result) {
          displayedCount++
          
          const providerLabel = result.model ? 
            `${result.provider} (${result.model})` : 
            result.provider
          process.stdout.write(`\n${color.cyan}${providerLabel}${color.reset}:\n`)
          
          if (result.error) {
            process.stdout.write(`${color.red}Error: ${result.error}${color.reset}\n`)
          }
        }
      }
      
      // Execute multi-command processing
      const result = await this.multiCommandProcessor.executeMultiple(
        context.processedInput,
        context.abortController.signal,
        models,
        null,
        onProviderComplete
      )
      
      // Add summary if multiple providers
      if (result.results.length > 1) {
        process.stdout.write(`\n${color.grey}[${result.successful}/${result.total} models responded in ${result.elapsed}s]${color.reset}\n`)
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
   * @private
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processMultiProvider(context) {
    if (!this.multiProviderTranslator) {
      throw new AppError('Multi-provider translator not available', true, 503)
    }
    
    const instruction = context.instructionInfo
    
    this.log('info', `Processing multi-provider request: ${instruction.commandType}`)
    
    try {
      const result = await this.multiProviderTranslator.translateMultiple(
        instruction.commandType,
        instruction.instruction,
        instruction.targetContent,
        context.abortController.signal,
        instruction.models
      )
      
      const formattedResponse = this.multiProviderTranslator.formatMultiProviderResponse(result)
      process.stdout.write(formattedResponse + '\n')
      
      // Cache the responses if cache info available
      if (context.cacheInfo?.shouldCache && this.cache) {
        await this.cacheMultiProviderResponse(context, result.translations)
      }
      
      return this.createResult(result.translations, { 
        stopChain: true,
        metadata: {
          strategy: 'multi-provider',
          providerCount: result.total,
          successfulProviders: result.successful
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
   * @private
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processDocument(context) {
    if (!this.multiProviderTranslator || !this.fileManager) {
      throw new AppError('Document processing services not available', true, 503)
    }
    
    const instruction = context.instructionInfo
    
    this.log('info', `Processing document translation: ${instruction.commandKey}`)
    
    try {
      const result = await this.multiProviderTranslator.translateSingle(
        instruction.instruction,
        instruction.targetContent,
        context.abortController.signal,
        instruction.models
      )
      
      if (result.result?.response) {
        process.stdout.write(result.result.response + '\n')
        
        // Save to file
        const fileInfo = await this.fileManager.saveDocumentTranslation(
          result.result.response,
          instruction.targetContent,
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
        console.log(`${color.red}Document translation failed${color.reset}`)
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
   * @private
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Processing result
   */
  async processSingleStream(context) {
    if (!this.providerService || !this.streamingService) {
      throw new AppError('Streaming services not available', true, 503)
    }
    
    this.log('info', 'Processing single stream request')
    
    try {
      // Get current provider
      const currentProvider = this.providerService.getCurrentProvider()
      if (!currentProvider || !currentProvider.provider) {
        throw new AppError('No AI provider available', true, 503)
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
            process.stdout.write(chunk)
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
   * @private
   * @param {Object} context - Processing context
   * @returns {Array} Messages array
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
   * @private
   * @param {Object} context - Processing context
   * @param {string} response - AI response
   * @param {Array} messages - Request messages
   */
  async handleSingleStreamResponse(context, response, messages) {
    const instruction = context.instructionInfo
    
    if (instruction?.isTranslation) {
      // Cache translation if cache info available
      if (context.cacheInfo?.shouldCache && this.cache) {
        await this.cacheSingleResponse(context, response)
      }
    } else {
      // Add to context history for chat
      if (context.services.addToContext) {
        context.services.addToContext('user', context.processedInput)
        context.services.addToContext('assistant', response)
        
        // Show context dots
        const historyLength = context.services.contextHistory?.length || 0
        const historyDots = '.'.repeat(historyLength)
        process.stdout.write('\n' + color.yellow + historyDots + color.reset + '\n')
      }
    }
  }

  /**
   * Cache single response
   * @private
   */
  async cacheSingleResponse(context, response) {
    if (this.cache?.set) {
      await this.cache.set(context.cacheInfo.key, response)
    }
  }

  /**
   * Cache multi-provider response
   * @private
   */
  async cacheMultiProviderResponse(context, responses) {
    if (this.cache?.setMultipleResponses) {
      await this.cache.setMultipleResponses(context.cacheInfo.key, responses)
    }
  }

  /**
   * Cache multi-command response
   * @private
   */
  async cacheMultiCommandResponse(context, responses) {
    if (this.cache?.setMultipleResponses) {
      const formattedResponses = responses.map(r => ({
        provider: r.provider,
        model: r.model,
        response: r.response,
        error: r.error
      }))
      await this.cache.setMultipleResponses(context.cacheInfo.key, formattedResponses)
    }
  }

  /**
   * Cache document response
   * @private
   */
  async cacheDocumentResponse(context, fileInfo, response) {
    if (this.cache?.setDocumentFile) {
      await this.cache.setDocumentFile(context.cacheInfo.key, fileInfo, response)
    }
  }

  /**
   * Handle stream processing errors
   * @private
   * @param {Error} error - The error
   * @param {Object} context - Processing context
   * @returns {Object} Handler result
   */
  handleStreamError(error, context) {
    if (this.isAbortError(error)) {
      // User cancellation - not really an error
      return this.createResult(null, { stopChain: true })
    }
    
    // Show user-friendly error
    console.log(`${color.red}AI processing error: ${this.getUserFriendlyError(error)}${color.reset}`)
    
    return this.createResult(null, { 
      stopChain: true,
      metadata: { error: error.message }
    })
  }

  /**
   * Handle provider-specific errors
   * @private
   * @param {Error} error - Provider error
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Handler result
   */
  async handleProviderError(error, context) {
    if (error.message.includes('403') && error.message.includes('Country, region, or territory not supported')) {
      console.log(`${color.yellow}Region blocked. Trying alternative provider...${color.reset}`)
      
      // Try alternative provider
      if (this.providerService.tryAlternativeProvider) {
        try {
          const alternative = await this.providerService.tryAlternativeProvider()
          if (alternative) {
            // Retry with new provider
            return await this.processSingleStream(context)
          }
        } catch (retryError) {
          console.log(`${color.red}All providers failed.${color.reset}`)
        }
      }
    }
    
    throw error // Re-throw if can't handle
  }

  /**
   * Check if error is an abort error
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if abort error
   */
  isAbortError(error) {
    return error.name === 'AbortError' || 
           error.message === 'AbortError' ||
           error.message.includes('aborted') ||
           error.message.includes('cancelled')
  }

  /**
   * Check if error is a provider error that can be handled
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if handleable provider error
   */
  isProviderError(error) {
    return error.message.includes('403') && 
           error.message.includes('Country, region, or territory not supported')
  }

  /**
   * Convert technical errors to user-friendly messages
   * @private
   * @param {Error} error - Technical error
   * @returns {string} User-friendly error message
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
   * @private
   * @param {string} strategy - Processing strategy
   * @param {boolean} success - Whether operation succeeded
   * @param {string} error - Error message if failed
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
   * @override
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
   * @override
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
   * @override
   */
  dispose() {
    super.dispose()
    this.streamStats.clear()
    this.lastStreamOperation = null
  }
}