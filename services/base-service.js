import { AppError } from '../utils/error-handler.js'

/**
 * Base service interface with common functionality
 * All application services should extend this class
 */
export class BaseService {
  /**
   * @param {Object} dependencies - Service dependencies
   * @param {import('../utils/event-bus.js').EventBus} dependencies.eventBus - Event bus instance
   * @param {Object} dependencies.logger - Logger instance
   * @param {Object} dependencies.config - Configuration manager
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
   * @returns {Promise<void>}
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
      throw new AppError(`Service initialization failed: ${this.serviceName}`, true, 500)
    }
  }

  /**
   * Service-specific initialization logic - override in subclasses
   * @protected
   * @returns {Promise<void>}
   */
  async onInitialize() {
    // Override in subclasses
  }

  /**
   * Dispose service and cleanup resources
   * @returns {Promise<void>}
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
   * @protected
   * @returns {Promise<void>}
   */
  async onDispose() {
    // Override in subclasses
  }

  /**
   * Check if service is ready for use
   * @returns {boolean} True if service is initialized and not disposed
   */
  isReady() {
    return this.isInitialized && !this.isDisposed
  }

  /**
   * Ensure service is ready before operation
   * @protected
   * @throws {AppError} If service is not ready
   */
  ensureReady() {
    if (!this.isReady()) {
      throw new AppError(
        `Service ${this.serviceName} is not ready. Initialized: ${this.isInitialized}, Disposed: ${this.isDisposed}`,
        true,
        503
      )
    }
  }

  /**
   * Get service health status
   * @returns {Object} Health status information
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
   * @private
   * @param {Object} dependencies - Dependencies object
   */
  validateDependencies(dependencies) {
    const required = this.getRequiredDependencies()
    const missing = required.filter(dep => !dependencies[dep])
    
    if (missing.length > 0) {
      throw new AppError(
        `Service ${this.serviceName} missing required dependencies: ${missing.join(', ')}`,
        true,
        400
      )
    }
  }

  /**
   * Get list of required dependencies - override in subclasses
   * @protected
   * @returns {string[]} Array of required dependency names
   */
  getRequiredDependencies() {
    return [] // Base service has no required dependencies
  }

  /**
   * Setup error handling for the service
   * @private
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
   * @protected
   * @param {string} eventName - Event name (will be prefixed with service name)
   * @param {any} data - Event data
   * @param {Object} options - Event options
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
   * @protected
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Log message
   * @param {Object} context - Additional context
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
   * @returns {Object} Service metrics
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
   * @protected
   * @returns {Object} Custom metrics
   */
  getCustomMetrics() {
    return {}
  }
}

/**
 * Service factory function with dependency validation
 * @param {Function} ServiceClass - Service constructor
 * @param {Object} dependencies - Service dependencies
 * @returns {BaseService} Service instance
 */
export function createService(ServiceClass, dependencies) {
  if (!ServiceClass || typeof ServiceClass !== 'function') {
    throw new AppError('ServiceClass must be a constructor function', true, 400)
  }

  if (!ServiceClass.prototype instanceof BaseService) {
    throw new AppError('ServiceClass must extend BaseService', true, 400)
  }

  return new ServiceClass(dependencies)
}