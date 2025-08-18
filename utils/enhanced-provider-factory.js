import { BaseProvider, OpenAIProvider, AnthropicProvider } from './provider-factory.js'
import { AppError } from './error-handler.js'
import { logger } from './logger.js'
import { validateObject } from './validation.js'
import { API_PROVIDERS } from '../config/api_providers.js'

/**
 * Enhanced Provider Factory with modern design patterns
 * Implements Factory Method, Builder, Registry, and Plugin patterns
 */
export class EnhancedProviderFactory {
  constructor() {
    this.providerRegistry = new Map()
    this.instanceRegistry = new Map()
    this.middleware = []
    this.plugins = new Map()
    this.config = {
      defaultTimeout: 180000,
      defaultRetries: 3,
      instancePoolSize: 5
    }
    this.stats = {
      providersCreated: 0,
      providersDestroyed: 0,
      middlewareExecutions: 0
    }
    
    this.initializeBuiltinProviders()
  }

  /**
   * Initialize built-in providers with enhanced configuration
   * @private
   */
  initializeBuiltinProviders() {
    // Register provider factories with enhanced features using API_PROVIDERS config
    this.registerProviderFactory('openai', {
      class: OpenAIProvider,
      features: ['streaming', 'function-calling', 'vision'],
      priority: 1,
      defaultConfig: {
        ...API_PROVIDERS.openai,
        timeout: 180000,
        retries: 3,
        rateLimitRequests: 20,
        rateLimitWindow: 60000
      }
    })

    this.registerProviderFactory('deepseek', {
      class: OpenAIProvider,
      features: ['streaming', 'function-calling'],
      priority: 2,
      defaultConfig: {
        ...API_PROVIDERS.deepseek,
        timeout: 120000,
        retries: 2,
        rateLimitRequests: 15,
        rateLimitWindow: 60000
      }
    })

    this.registerProviderFactory('anthropic', {
      class: AnthropicProvider,
      features: ['streaming', 'large-context'],
      priority: 3,
      defaultConfig: {
        ...API_PROVIDERS.anthropic,
        timeout: 300000,
        retries: 3,
        rateLimitRequests: 10,
        rateLimitWindow: 60000
      }
    })

    logger.debug('Built-in provider factories registered')
  }

  /**
   * Register a provider factory with metadata
   * @param {string} type - Provider type
   * @param {Object} factory - Provider factory configuration
   */
  registerProviderFactory(type, factory) {
    if (!factory.class || typeof factory.class !== 'function') {
      throw new AppError('Provider factory must have a class constructor', true, 400)
    }

    this.providerRegistry.set(type, {
      ...factory,
      registeredAt: Date.now(),
      instances: new Map(),
      stats: {
        created: 0,
        destroyed: 0,
        errors: 0,
        lastCreated: null
      }
    })

    logger.info(`Provider factory registered: ${type}`)
  }

  /**
   * Create provider with Builder pattern and middleware
   * @param {string} type - Provider type
   * @returns {ProviderBuilder} Builder instance
   */
  createProvider(type) {
    return new ProviderBuilder(this, type)
  }

  /**
   * Create provider instance with middleware pipeline
   * @private
   * @param {string} type - Provider type
   * @param {Object} config - Provider configuration
   * @param {Object} options - Creation options
   * @returns {Object} Provider instance
   */
  async _createProviderInstance(type, config, options = {}) {
    const factory = this.providerRegistry.get(type)
    if (!factory) {
      throw new AppError(`Unknown provider type: ${type}`, true, 404)
    }

    // Merge default config with provided config
    const mergedConfig = this._mergeConfig(factory.defaultConfig, config)
    
    // Validate configuration
    validateObject(mergedConfig, 'provider config')

    try {
      // Apply middleware pipeline
      const context = {
        type,
        config: mergedConfig,
        options,
        factory,
        timestamp: Date.now()
      }

      await this._runMiddleware('before-create', context)

      // Create instance
      const instance = new factory.class(context.config)
      
      // Apply instance enhancements
      await this._enhanceInstance(instance, context)

      // Register instance
      const instanceId = this._generateInstanceId(type, options)
      this.instanceRegistry.set(instanceId, {
        instance,
        type,
        config: context.config,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        stats: {
          requests: 0,
          errors: 0,
          uptime: 0
        }
      })

      // Update factory stats
      factory.stats.created++
      factory.stats.lastCreated = Date.now()
      factory.instances.set(instanceId, instance)

      // Run post-creation middleware
      context.instance = instance
      context.instanceId = instanceId
      await this._runMiddleware('after-create', context)

      this.stats.providersCreated++
      logger.info(`Provider instance created: ${instanceId}`)

      return {
        instance,
        instanceId,
        type,
        features: factory.features || []
      }
    } catch (error) {
      factory.stats.errors++
      throw new AppError(`Failed to create provider ${type}: ${error.message}`, true, 500)
    }
  }

  /**
   * Add middleware to the creation pipeline
   * @param {string} phase - Middleware phase (before-create, after-create, etc.)
   * @param {Function} middleware - Middleware function
   */
  addMiddleware(phase, middleware) {
    if (typeof middleware !== 'function') {
      throw new AppError('Middleware must be a function', true, 400)
    }

    this.middleware.push({ phase, middleware })
    logger.debug(`Middleware added for phase: ${phase}`)
  }

  /**
   * Add plugin for extending functionality
   * @param {string} name - Plugin name
   * @param {Object} plugin - Plugin configuration
   */
  addPlugin(name, plugin) {
    if (typeof plugin.initialize !== 'function') {
      throw new AppError('Plugin must have an initialize function', true, 400)
    }

    this.plugins.set(name, plugin)
    plugin.initialize(this)
    logger.info(`Plugin registered: ${name}`)
  }

  /**
   * Get provider instance by ID
   * @param {string} instanceId - Instance ID
   * @returns {Object|null} Provider instance data
   */
  getInstance(instanceId) {
    const instanceData = this.instanceRegistry.get(instanceId)
    if (instanceData) {
      instanceData.lastUsed = Date.now()
    }
    return instanceData
  }

  /**
   * Get all instances of a specific type
   * @param {string} type - Provider type
   * @returns {Array} Array of instances
   */
  getInstancesByType(type) {
    const instances = []
    for (const [id, data] of this.instanceRegistry) {
      if (data.type === type) {
        instances.push({ id, ...data })
      }
    }
    return instances
  }

  /**
   * Get provider with load balancing
   * @param {string} type - Provider type
   * @param {Object} criteria - Selection criteria
   * @returns {Object|null} Best provider instance
   */
  getBestProvider(type, criteria = {}) {
    const instances = this.getInstancesByType(type)
    if (instances.length === 0) return null

    // Simple load balancing - return least used instance
    return instances.reduce((best, current) => {
      if (!best) return current
      return current.stats.requests < best.stats.requests ? current : best
    })
  }

  /**
   * Destroy provider instance
   * @param {string} instanceId - Instance ID
   * @returns {boolean} Success status
   */
  async destroyInstance(instanceId) {
    const instanceData = this.instanceRegistry.get(instanceId)
    if (!instanceData) {
      return false
    }

    try {
      // Run destruction middleware
      await this._runMiddleware('before-destroy', { instanceId, ...instanceData })

      // Clean up instance
      if (instanceData.instance.dispose) {
        await instanceData.instance.dispose()
      }

      // Remove from registries
      this.instanceRegistry.delete(instanceId)
      
      const factory = this.providerRegistry.get(instanceData.type)
      if (factory) {
        factory.instances.delete(instanceId)
        factory.stats.destroyed++
      }

      this.stats.providersDestroyed++
      logger.info(`Provider instance destroyed: ${instanceId}`)

      return true
    } catch (error) {
      logger.error(`Failed to destroy instance ${instanceId}:`, error)
      return false
    }
  }

  /**
   * Get comprehensive factory statistics
   * @returns {Object} Factory statistics
   */
  getFactoryStats() {
    const providerStats = {}
    
    for (const [type, factory] of this.providerRegistry) {
      providerStats[type] = {
        ...factory.stats,
        activeInstances: factory.instances.size,
        features: factory.features,
        priority: factory.priority
      }
    }

    return {
      ...this.stats,
      totalInstances: this.instanceRegistry.size,
      providers: providerStats,
      middleware: this.middleware.length,
      plugins: this.plugins.size
    }
  }


  /**
   * Private helper methods
   */

  _mergeConfig(defaultConfig, userConfig) {
    return {
      ...this.config,
      ...defaultConfig,
      ...userConfig
    }
  }

  _generateInstanceId(type, options) {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substr(2, 9)
    return `${type}-${timestamp}-${random}`
  }

  async _runMiddleware(phase, context) {
    const middlewares = this.middleware.filter(m => m.phase === phase)
    
    for (const { middleware } of middlewares) {
      try {
        await middleware(context)
        this.stats.middlewareExecutions++
      } catch (error) {
        logger.error(`Middleware error in phase ${phase}:`, error)
        throw error
      }
    }
  }

  async _enhanceInstance(instance, context) {
    // Add common enhancements
    instance.createdAt = context.timestamp
    instance.factoryType = context.type
    
    // Add metrics collection
    const originalCreateCompletion = instance.createChatCompletion
    instance.createChatCompletion = async function(...args) {
      const start = Date.now()
      try {
        const result = await originalCreateCompletion.apply(this, args)
        this.stats.requests++
        return result
      } catch (error) {
        this.stats.errors++
        throw error
      } finally {
        this.stats.totalResponseTime += Date.now() - start
      }
    }
    
    // Apply plugins
    for (const [name, plugin] of this.plugins) {
      if (plugin.enhanceInstance) {
        await plugin.enhanceInstance(instance, context)
      }
    }
  }



  /**
   * Dispose factory and all instances
   */
  async dispose() {
    logger.info('Disposing EnhancedProviderFactory...')
    
    // Destroy all instances
    const instanceIds = Array.from(this.instanceRegistry.keys())
    await Promise.all(instanceIds.map(id => this.destroyInstance(id)))

    // Clear registries
    this.providerRegistry.clear()
    this.instanceRegistry.clear()
    this.middleware = []
    this.plugins.clear()

    logger.info('EnhancedProviderFactory disposed')
  }
}

/**
 * Builder pattern for creating providers
 */
export class ProviderBuilder {
  constructor(factory, type) {
    this.factory = factory
    this.type = type
    this.config = {}
    this.options = {}
  }

  withConfig(config) {
    this.config = { ...this.config, ...config }
    return this
  }

  withTimeout(timeout) {
    this.config.timeout = timeout
    return this
  }

  withRetries(retries) {
    this.config.retries = retries
    return this
  }

  withRateLimit(requests, window) {
    this.config.rateLimitRequests = requests
    this.config.rateLimitWindow = window
    return this
  }

  withOptions(options) {
    this.options = { ...this.options, ...options }
    return this
  }

  async build() {
    return await this.factory._createProviderInstance(this.type, this.config, this.options)
  }
}

// Export singleton instance
export const enhancedProviderFactory = new EnhancedProviderFactory()

// Convenience function
export function createEnhancedProvider(type) {
  return enhancedProviderFactory.createProvider(type)
}