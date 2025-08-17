import { CommandProcessingService } from './command-processing-service.js'
import { AIProviderService } from './ai-provider-service.js'
import { InputProcessingService } from './input-processing-service.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

/**
 * Central service manager that coordinates all application services
 * Implements dependency injection and service lifecycle management
 */
export class ServiceManager {
  constructor(app) {
    this.app = app
    this.logger = logger
    this.services = new Map()
    this.serviceOrder = [] // Track initialization order for proper disposal
    this.initialized = false
    this.startTime = null
    this.stats = {
      servicesInitialized: 0,
      initializationErrors: 0,
      totalInitTime: 0
    }
  }

  /**
   * Initialize all application services
   */
  async initialize() {
    if (this.initialized) return
    
    this.startTime = Date.now()
    this.logger.debug('ServiceManager: Starting service initialization...')
    
    try {
      // Initialize services in dependency order
      await this.initializeInputProcessingService()
      // await this.initializeCommandProcessingService() // DISABLED - using CommandRouter from DB
      
      // Always use modern provider initialization
      this.logger.debug('ServiceManager: Modern AI provider initialization')
      await this.initializeAIProviderService()
      
      // Initialize multi-command processor for commands with multiple models
      this.logger.debug('ServiceManager: Initializing MultiCommandProcessor')
      await multiCommandProcessor.initialize()
      
      this.initialized = true
      this.stats.totalInitTime = Date.now() - this.startTime
      
      this.logger.debug(`ServiceManager: All services initialized in ${this.stats.totalInitTime}ms`)
      this.logServiceStatus()
      
    } catch (error) {
      this.stats.initializationErrors++
      this.logger.error('ServiceManager: Service initialization failed:', error)
      throw error
    }
  }

  /**
   * Initialize Input Processing Service
   * @private
   */
  async initializeInputProcessingService() {
    const serviceName = 'inputProcessing'
    try {
      const service = new InputProcessingService({
        logger: this.logger,
        app: this.app
      })
      
      await service.initialize()
      this.registerService(serviceName, service)
      this.logger.debug('InputProcessingService initialized')
    } catch (error) {
      throw new Error(`Failed to initialize ${serviceName}: ${error.message}`)
    }
  }

  /**
   * Initialize Command Processing Service
   * @private
   */
  async initializeCommandProcessingService() {
    const serviceName = 'commandProcessing'
    try {
      const service = new CommandProcessingService({
        logger: this.logger,
        app: this.app
      })
      
      await service.initialize()
      this.registerService(serviceName, service)
      this.logger.debug('CommandProcessingService initialized')
    } catch (error) {
      throw new Error(`Failed to initialize ${serviceName}: ${error.message}`)
    }
  }

  /**
   * Initialize AI Provider Service
   * @private
   */
  async initializeAIProviderService() {
    const serviceName = 'aiProvider'
    try {
      const service = new AIProviderService({
        logger: this.logger,
        app: this.app
      })
      
      await service.initialize()
      this.registerService(serviceName, service)
      this.logger.debug('AIProviderService initialized')
    } catch (error) {
      throw new Error(`Failed to initialize ${serviceName}: ${error.message}`)
    }
  }

  /**
   * Register a service with the manager
   * @private
   */
  registerService(name, service) {
    this.services.set(name, service)
    this.serviceOrder.push(name)
    this.stats.servicesInitialized++
  }

  /**
   * Get a specific service
   * @param {string} serviceName - Name of the service
   * @returns {Object|null} Service instance or null
   */
  getService(serviceName) {
    return this.services.get(serviceName) || null
  }

  /**
   * Get input processing service
   * @returns {InputProcessingService}
   */
  getInputProcessingService() {
    return this.getService('inputProcessing')
  }

  /**
   * Get command processing service
   * @returns {CommandProcessingService}
   */
  getCommandProcessingService() {
    // DISABLED - using CommandRouter from DB instead
    return null
    // return this.getService('commandProcessing')
  }

  /**
   * Get AI provider service
   * @returns {AIProviderService}
   */
  getAIProviderService() {
    return this.getService('aiProvider')
  }

  /**
   * Process user input through all services
   * @param {string} rawInput - Raw user input
   * @returns {Object} Processed input result
   */
  async processUserInput(rawInput) {
    const inputService = this.getInputProcessingService()
    if (!inputService) {
      throw new Error('Input processing service not available')
    }
    
    return await inputService.processInput(rawInput)
  }

  /**
   * Find command using database directly
   * @param {string} input - User input
   * @returns {Object|null} Command information
   */
  async findCommand(input) {
    // DISABLED - use database directly instead of CommandProcessingService
    const { getCommandsFromDB } = await import('../utils/database-manager.js')
    const commands = getCommandsFromDB()
    
    const words = input.trim().split(' ')
    const commandName = words[0].toLowerCase()
    
    for (const [id, command] of Object.entries(commands)) {
      if (command.key && command.key.includes(commandName)) {
        return { id, ...command }
      }
    }
    return null
  }

  /**
   * Create AI chat completion
   * @param {Array} messages - Chat messages
   * @param {Object} options - Completion options
   * @returns {Promise} AI response
   */
  async createChatCompletion(messages, options = {}) {
    const aiService = this.getAIProviderService()
    if (!aiService) {
      throw new Error('AI provider service not available')
    }
    
    return await aiService.createChatCompletion(messages, options)
  }

  /**
   * Switch AI provider
   * @param {string} providerKey - Provider key
   * @param {string} model - Model name (optional)
   * @returns {Promise<Object>} Switch result
   */
  async switchProvider(providerKey, model = null) {
    const aiService = this.getAIProviderService()
    if (!aiService) {
      throw new Error('AI provider service not available')
    }
    
    return await aiService.switchProvider(providerKey, model)
  }

  /**
   * Try alternative AI provider
   * @returns {Promise<boolean>} Success status
   */
  async tryAlternativeProvider() {
    const aiService = this.getAIProviderService()
    if (!aiService) {
      return false
    }
    
    return await aiService.tryAlternativeProvider()
  }

  /**
   * Get comprehensive service status
   * @returns {Object} Service status information
   */
  getServiceStatus() {
    const status = {
      initialized: this.initialized,
      totalServices: this.services.size,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      services: {},
      overallHealth: true,
      stats: this.stats
    }
    
    for (const [name, service] of this.services) {
      const serviceHealth = service.getHealthStatus ? service.getHealthStatus() : { isHealthy: true }
      status.services[name] = serviceHealth
      
      if (!serviceHealth.isHealthy) {
        status.overallHealth = false
      }
    }
    
    return status
  }

  /**
   * Get aggregated service statistics
   * @returns {Object} Service statistics
   */
  getServiceStats() {
    const aggregated = {
      serviceManager: this.stats,
      services: {}
    }
    
    for (const [name, service] of this.services) {
      if (service.getProcessingStats) {
        aggregated.services[name] = service.getProcessingStats()
      } else if (service.getProviderStats) {
        aggregated.services[name] = service.getProviderStats()
      } else if (service.getCommandStats) {
        aggregated.services[name] = service.getCommandStats()
      }
    }
    
    return aggregated
  }

  /**
   * Log current service status
   * @private
   */
  logServiceStatus() {
    const status = this.getServiceStatus()
    
    // Silent mode - only log to debug, no console output for clean UI
    this.logger.debug(`Services initialized: ${Object.keys(status.services).join(', ')}`)
    this.logger.debug(`Total init time: ${status.stats.totalInitTime}ms`)
  }

  /**
   * Perform health check on all services
   * @returns {Object} Health check results
   */
  async performHealthCheck() {
    const results = {
      overall: true,
      services: {},
      timestamp: new Date(),
      issues: []
    }
    
    for (const [name, service] of this.services) {
      try {
        const health = service.getHealthStatus ? service.getHealthStatus() : { isHealthy: true }
        results.services[name] = health
        
        if (!health.isHealthy) {
          results.overall = false
          results.issues.push(`Service ${name} is unhealthy`)
        }
      } catch (error) {
        results.overall = false
        results.services[name] = { isHealthy: false, error: error.message }
        results.issues.push(`Health check failed for ${name}: ${error.message}`)
      }
    }
    
    return results
  }

  /**
   * Gracefully dispose of all services
   */
  async dispose() {
    this.logger.info('ServiceManager: Disposing services...')
    
    // Dispose services in reverse order of initialization
    const reversedOrder = [...this.serviceOrder].reverse()
    
    for (const serviceName of reversedOrder) {
      const service = this.services.get(serviceName)
      if (service && service.dispose) {
        try {
          await service.dispose()
          this.logger.debug(`Service ${serviceName} disposed`)
        } catch (error) {
          this.logger.error(`Error disposing service ${serviceName}:`, error)
        }
      }
    }
    
    this.services.clear()
    this.serviceOrder = []
    this.initialized = false
    this.logger.info('ServiceManager: All services disposed')
  }

}

// Export singleton instance
let serviceManagerInstance = null

export function getServiceManager(app = null) {
  if (!serviceManagerInstance && app) {
    serviceManagerInstance = new ServiceManager(app)
  }
  return serviceManagerInstance
}