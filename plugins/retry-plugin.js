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
      ]
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
      const retries = options.retries ?? this.options.maxRetries
      let lastError = null
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await originalMethod(model, messages, options)
        } catch (error) {
          lastError = error
          
          // Check if error is retryable
          if (!this.isRetryableError(error) || attempt === retries) {
            throw error
          }
          
          // Calculate delay with exponential backoff
          const delay = Math.min(
            this.options.initialDelay * Math.pow(this.options.backoffMultiplier, attempt),
            this.options.maxDelay
          )
          
          console.log(`Retry attempt ${attempt + 1}/${retries} after ${delay}ms delay`)
          await this.sleep(delay)
        }
      }
      
      throw lastError
    }
    
    // Add retry stats
    instance.retryStats = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0
    }
  }

  isRetryableError(error) {
    return this.options.retryableErrors.some(errorType => 
      error.name === errorType || 
      error.message.includes(errorType) ||
      error.code === errorType
    )
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}