/**
 * Retry Plugin for Enhanced Provider Factory
 * Adds automatic retry logic with exponential backoff
 */
export class RetryPlugin {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || 3,
      initialDelay: options.initialDelay || 1000,
      maxDelay: options.maxDelay || 30000,
      backoffMultiplier: options.backoffMultiplier || 2,
      retryableErrors: options.retryableErrors || [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'ECONNREFUSED',
        'AbortError'
      ],
      // Specific retry settings for Anthropic overloaded errors
      anthropicRetries: {
        maxRetries: options.anthropicRetries?.maxRetries || 5,
        initialDelay: options.anthropicRetries?.initialDelay || 2000,
        maxDelay: options.anthropicRetries?.maxDelay || 60000,
        backoffMultiplier: options.anthropicRetries?.backoffMultiplier || 1.5
      }
    }
  }

  initialize(factory) {
    this.factory = factory
    
    // Add middleware to enhance instances with retry logic
    factory.addMiddleware('after-create', (context) => {
      this.enhanceInstanceWithRetry(context.instance)
    })
  }

  enhanceInstanceWithRetry(instance) {
    // Wrap the createChatCompletion method with retry logic
    const originalMethod = instance.createChatCompletion.bind(instance)
    
    instance.createChatCompletion = async (model, messages, options = {}) => {
      // Don't retry if signal is already aborted
      if (options.signal && options.signal.aborted) {
        throw new Error('AbortError')
      }
      
      // Determine if this is an Anthropic provider (Claude)
      const isAnthropicProvider = instance.config?.name?.toLowerCase().includes('anthropic') || 
                                  instance.constructor.name === 'AnthropicProvider'
      
      let lastError = null
      let maxRetries = this.options.maxRetries
      let initialDelay = this.options.initialDelay
      let maxDelay = this.options.maxDelay
      let backoffMultiplier = this.options.backoffMultiplier
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await originalMethod(model, messages, options)
          
          // Update retry stats on success
          if (attempt > 0) {
            instance.retryStats.successfulRetries++
            instance.retryStats.totalRetries += attempt
          }
          
          return result
        } catch (error) {
          lastError = error
          
          // Check if signal was aborted during request
          if (options.signal && options.signal.aborted) {
            throw new Error('AbortError')
          }
          
          // Check if error is retryable
          const isRetryable = this.isRetryableError(error, isAnthropicProvider)
          if (!isRetryable || attempt === maxRetries) {
            // Update failed retry stats
            if (attempt > 0) {
              instance.retryStats.failedRetries++
              instance.retryStats.totalRetries += attempt
            }
            throw error
          }
          
          // Use Anthropic-specific retry settings for overloaded errors
          if (isAnthropicProvider && this.isAnthropicOverloadedError(error)) {
            maxRetries = this.options.anthropicRetries.maxRetries
            initialDelay = this.options.anthropicRetries.initialDelay
            maxDelay = this.options.anthropicRetries.maxDelay
            backoffMultiplier = this.options.anthropicRetries.backoffMultiplier
            
            console.log(`Anthropic overloaded error detected. Using extended retry settings...`)
          }
          
          // Calculate delay with exponential backoff
          const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay
          )
          
          const errorType = this.isAnthropicOverloadedError(error) ? 'overloaded_error' : 'network_error'
          console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms delay (${errorType})`)
          
          // Check for abort signal before sleeping
          if (options.signal && options.signal.aborted) {
            throw new Error('AbortError')
          }
          
          await this.sleep(delay)
        }
      }
      
      throw lastError
    }
    
    // Add retry stats
    instance.retryStats = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      anthropicOverloadedErrors: 0
    }
  }

  isRetryableError(error, isAnthropicProvider = false) {
    // Check standard retryable errors
    const standardRetryable = this.options.retryableErrors.some(errorType => 
      error.name === errorType || 
      error.message.includes(errorType) ||
      error.code === errorType
    )
    
    // Check Anthropic-specific retryable errors
    if (isAnthropicProvider) {
      return standardRetryable || this.isAnthropicOverloadedError(error)
    }
    
    return standardRetryable
  }

  /**
   * Check if error is Anthropic overloaded_error


   */
  isAnthropicOverloadedError(error) {
    return error.message && (
      error.message.includes('overloaded_error') ||
      error.message.includes('Overloaded') ||
      error.message.includes('529') ||
      (error.message.includes('Anthropic') && error.message.includes('overload'))
    )
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}