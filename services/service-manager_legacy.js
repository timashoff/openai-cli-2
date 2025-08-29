import { InputProcessingService } from './input-processing-service.js'
import { AIProviderService, createAIProviderService } from './ai-provider-service.js'
import { databaseCommandService } from './DatabaseCommandService.js'
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
   */
  async initializeCommandProcessingService() {
    const serviceName = 'commandProcessing'
    try {
      const service = new InputProcessingService({
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
   */
  async initializeAIProviderService() {
    const serviceName = 'aiProvider'
    try {
      // Use functional factory instead of class constructor
      const service = createAIProviderService({
        stateManager: this.app.stateManager,
        logger: this.logger
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
   */
  registerService(name, service) {
    this.services.set(name, service)
    this.serviceOrder.push(name)
    this.stats.servicesInitialized++
  }

  /**
   * Get a specific service
   */
  getService(serviceName) {
    return this.services.get(serviceName) || null
  }

  /**
   * Get input processing service
   */
  getInputProcessingService() {
    return this.getService('inputProcessing')
  }

  /**
   * Get command processing service
   */
  getCommandProcessingService() {
    // DISABLED - using CommandRouter from DB instead
    return null
    // return this.getService('commandProcessing')
  }

  /**
   * Get AI provider service
   */
  getAIProviderService() {
    return this.getService('aiProvider')
  }

  /**
   * Process user input through all services
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
   */
  async findCommand(input) {
    // Use DatabaseCommandService instead of CommandProcessingService
    const commands = databaseCommandService.getCommands()
    
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
   */
  getServiceStatus() {
    const status = {
      initialized: this.initialized,
      totalServices: this.services.size,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      services: {},
      stats: this.stats
    }
    
    for (const [name, service] of this.services) {
      const serviceInfo = { initialized: true }
      status.services[name] = serviceInfo
    }
    
    return status
  }

  /**
   * Get aggregated service statistics
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
   */
  logServiceStatus() {
    const status = this.getServiceStatus()
    
    // Silent mode - only log to debug, no console output for clean UI
    this.logger.debug(`Services initialized: ${Object.keys(status.services).join(', ')}`)
    this.logger.debug(`Total init time: ${status.stats.totalInitTime}ms`)
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