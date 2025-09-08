import { BaseError } from '../core/error-system/index.js'

/**
 * Base service interface with common functionality
 * All application services should extend this class
 */
export class BaseService {
  /**




   */
  constructor(dependencies = {}) {
    this.eventBus = dependencies.eventBus
    this.logger = dependencies.logger
    this.config = dependencies.config
    this.isInitialized = false
    this.isDisposed = false
    this.serviceName = this.constructor.name
    
    // Validate required dependencies
    this.validateDependencies(dependencies)
    
    // Register error handlers
    this.setupErrorHandling()
  }

  /**
   * Initialize the service - must be implemented by subclasses

   */
  async initialize() {
    if (this.isInitialized) {
      this.logger?.warn(`Service ${this.serviceName} already initialized`)
      return
    }

    try {
      await this.onInitialize()
      this.isInitialized = true
      this.eventBus?.emitSync(`service:${this.serviceName.toLowerCase()}:initialized`, {
        serviceName: this.serviceName,
        timestamp: new Date()
      })
      
      this.logger?.info(`Service ${this.serviceName} initialized successfully`)
    } catch (error) {
      this.logger?.error(`Failed to initialize service ${this.serviceName}:`, error.message)
      throw new BaseError(`Service initialization failed: ${this.serviceName}`, true, 500)
    }
  }

  /**
   * Service-specific initialization logic - override in subclasses

   */
  async onInitialize() {
    // Override in subclasses
  }

  /**
   * Dispose service and cleanup resources

   */
  async dispose() {
    if (this.isDisposed) return

    try {
      await this.onDispose()
      this.isDisposed = true
      this.isInitialized = false
      
      this.eventBus?.emitSync(`service:${this.serviceName.toLowerCase()}:disposed`, {
        serviceName: this.serviceName,
        timestamp: new Date()
      })
      
      this.logger?.info(`Service ${this.serviceName} disposed successfully`)
    } catch (error) {
      this.logger?.error(`Error disposing service ${this.serviceName}:`, error.message)
    }
  }

  /**
   * Service-specific cleanup logic - override in subclasses  

   */
  async onDispose() {
    // Override in subclasses
  }

  /**
   * Check if service is ready for use

   */
  isReady() {
    return this.isInitialized && !this.isDisposed
  }

  /**
   * Ensure service is ready before operation
   */
  ensureReady() {
    if (!this.isReady()) {
      throw new BaseError(
        `Service ${this.serviceName} is not ready. Initialized: ${this.isInitialized}, Disposed: ${this.isDisposed}`,
        true,
        503
      )
    }
  }

  /**
   * Get service health status

   */
  getHealthStatus() {
    return {
      serviceName: this.serviceName,
      isReady: this.isReady(),
      isInitialized: this.isInitialized,
      isDisposed: this.isDisposed,
      uptime: this.isInitialized ? Date.now() - this.initTimestamp : 0,
      lastHealthCheck: new Date(),
      status: this.isReady() ? 'healthy' : 'unhealthy'
    }
  }

  /**
   * Validate required dependencies

   */
  validateDependencies(dependencies) {
    const required = this.getRequiredDependencies()
    const missing = required.filter(dep => !dependencies[dep])
    
    if (missing.length > 0) {
      throw new BaseError(
        `Service ${this.serviceName} missing required dependencies: ${missing.join(', ')}`,
        true,
        400
      )
    }
  }

  /**
   * Get list of required dependencies - override in subclasses

   */
  getRequiredDependencies() {
    return [] // Base service has no required dependencies
  }

  /**
   * Setup error handling for the service
   */
  setupErrorHandling() {
    // Catch unhandled promise rejections in service methods
    process.on('unhandledRejection', (error, promise) => {
      this.logger?.error(`Unhandled rejection in service ${this.serviceName}:`, error.message)
      this.eventBus?.emitSync('service:error', {
        serviceName: this.serviceName,
        error: error.message,
        timestamp: new Date()
      })
    })
  }

  /**
   * Emit service event with context



   */
  emitEvent(eventName, data = null, options = {}) {
    if (!this.eventBus) return

    const fullEventName = `service:${this.serviceName.toLowerCase()}:${eventName}`
    const eventData = {
      serviceName: this.serviceName,
      data,
      timestamp: new Date()
    }

    this.eventBus.emitSync(fullEventName, eventData, {
      source: this.serviceName,
      ...options
    })
  }

  /**
   * Log message with service context



   */
  log(level, message, context = {}) {
    if (!this.logger || !this.logger[level]) return

    const logContext = {
      service: this.serviceName,
      timestamp: new Date(),
      ...context
    }

    this.logger[level](message, logContext)
  }

  /**
   * Get service metrics

   */
  getMetrics() {
    return {
      serviceName: this.serviceName,
      isReady: this.isReady(),
      uptime: this.isInitialized ? Date.now() - this.initTimestamp : 0,
      memoryUsage: process.memoryUsage(),
      ...this.getCustomMetrics()
    }
  }

  /**
   * Get custom service-specific metrics - override in subclasses

   */
  getCustomMetrics() {
    return {}
  }
}

/**
 * Service factory function with dependency validation



 */
export function createService(ServiceClass, dependencies) {
  if (!ServiceClass || typeof ServiceClass !== 'function') {
    throw new BaseError('ServiceClass must be a constructor function', true, 400)
  }

  if (!ServiceClass.prototype instanceof BaseService) {
    throw new BaseError('ServiceClass must extend BaseService', true, 400)
  }

  return new ServiceClass(dependencies)
}