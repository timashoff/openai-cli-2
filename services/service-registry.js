import { createContainer, ServiceLifetime } from '../utils/di-container.js'
import { createEventBus } from '../utils/event-bus.js'
import { errorBoundary, createBaseError } from '../core/error-system/index.js'

// Import all service classes
import { BaseService } from './base-service.js'
import { StreamingService } from './streaming-service.js'
import { AIProviderService } from './ai-provider-service.js'
import { InputProcessingService } from './input-processing-service.js'
import { MCPService } from './mcp-service.js'

/**
 * Service registration configuration
 */

/**
 * Service Registry - Central hub for managing all application services
 * Handles service registration, dependency injection, and lifecycle management
 */
export class ServiceRegistry {
  constructor() {
    /** @type {import('../utils/di-container.js').DIContainer} */
    this.container = createContainer()
    /** @type {Map<string, ServiceConfig>} */
    this.serviceConfigs = new Map()
    /** @type {Map<string, BaseService>} */
    this.activeServices = new Map()
    /** @type {boolean} */
    this.isInitialized = false
    /** @type {boolean} */
    this.isStarted = false
    
    this.setupCoreServices()
  }

  /**
   * Initialize the service registry and all core services


   */
  async initialize(externalDependencies = {}) {
    if (this.isInitialized) {
      console.warn('ServiceRegistry already initialized')
      return
    }

    console.log('🚀 Initializing ServiceRegistry...')
    
    try {
      // Register external dependencies first
      await this.registerExternalDependencies(externalDependencies)
      
      // Register all services with the DI container
      await this.registerAllServices()
      
      // Initialize core services
      await this.initializeCoreServices()
      
      this.isInitialized = true
      console.log('✓ ServiceRegistry initialized successfully')
      
      // Emit initialization event
      const eventBus = this.container.tryResolve('IEventBus')
      if (eventBus) {
        eventBus.emitSync('service-registry:initialized', {
          servicesCount: this.serviceConfigs.size,
          timestamp: new Date()
        })
      }
      
    } catch (error) {
      console.error('✗ ServiceRegistry initialization failed:', error.message)
      throw createBaseError(`ServiceRegistry initialization failed: ${error.message}`, true, 500)
    }
  }

  /**
   * Start all registered services

   */
  async start() {
    if (!this.isInitialized) {
      throw createBaseError('ServiceRegistry must be initialized before starting', true, 500)
    }

    if (this.isStarted) {
      console.warn('ServiceRegistry already started')
      return
    }

    console.log('🔧 Starting all services...')
    
    try {
      // Start services in dependency order
      const startOrder = this.calculateStartOrder()
      
      for (const serviceName of startOrder) {
        const service = this.container.tryResolve(serviceName)
        if (service && typeof service.initialize === 'function') {
          console.log(`  ▶️  Starting ${serviceName}...`)
          await service.initialize()
          this.activeServices.set(serviceName, service)
        }
      }
      
      this.isStarted = true
      console.log('✓ All services started successfully')
      
      // Emit start event
      const eventBus = this.container.tryResolve('IEventBus')
      if (eventBus) {
        eventBus.emitSync('service-registry:started', {
          activeServices: this.activeServices.size,
          timestamp: new Date()
        })
      }
      
    } catch (error) {
      console.error('✗ Service startup failed:', error.message)
      await this.shutdown() // Cleanup on failure
      throw createBaseError(`Service startup failed: ${error.message}`, true, 500)
    }
  }

  /**
   * Shutdown all services gracefully

   */
  async shutdown() {
    if (!this.isStarted) return

    console.log('🛑 Shutting down services...')
    
    // Shutdown in reverse order
    const shutdownOrder = this.calculateStartOrder().reverse()
    
    for (const serviceName of shutdownOrder) {
      const service = this.activeServices.get(serviceName)
      if (service && typeof service.dispose === 'function') {
        try {
          console.log(`  ⏹️  Shutting down ${serviceName}...`)
          await service.dispose()
        } catch (error) {
          console.error(`Error shutting down ${serviceName}:`, error.message)
        }
      }
    }
    
    // Dispose the DI container
    this.container.dispose()
    
    this.activeServices.clear()
    this.isStarted = false
    this.isInitialized = false
    
    console.log('✓ All services shut down')
  }

  /**
   * Get service instance by name


   */
  getService(serviceName) {
    return this.container.tryResolve(serviceName)
  }

  /**
   * Get all active services

   */
  getActiveServices() {
    return new Map(this.activeServices)
  }

  /**
   * Get service registry health status

   */
  getHealthStatus() {
    const serviceHealths = {}
    
    for (const [name, service] of this.activeServices) {
      serviceHealths[name] = service.getHealthStatus ? 
        service.getHealthStatus() : 
        { status: 'unknown', serviceName: name }
    }
    
    const totalServices = this.activeServices.size
    const healthyServices = Object.values(serviceHealths)
      .filter(health => health.status === 'healthy').length
    
    return {
      isInitialized: this.isInitialized,
      isStarted: this.isStarted,
      totalServices,
      healthyServices,
      unhealthyServices: totalServices - healthyServices,
      serviceHealths,
      overallStatus: healthyServices === totalServices ? 'healthy' : 'degraded'
    }
  }

  /**
   * Get service metrics for monitoring

   */
  getMetrics() {
    const metrics = {
      registry: {
        isInitialized: this.isInitialized,
        isStarted: this.isStarted,
        totalServices: this.serviceConfigs.size,
        activeServices: this.activeServices.size
      },
      services: {},
      container: this.container.getStats()
    }
    
    // Collect metrics from each service
    for (const [name, service] of this.activeServices) {
      if (service && typeof service.getMetrics === 'function') {
        try {
          metrics.services[name] = service.getMetrics()
        } catch (error) {
          metrics.services[name] = { error: error.message }
        }
      }
    }
    
    return metrics
  }

  /**
   * Setup core services configuration
   */
  setupCoreServices() {
    // Core infrastructure services
    this.serviceConfigs.set('IEventBus', {
      serviceClass: null, // Special case - created directly
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: [],
      options: {}
    })

    this.serviceConfigs.set('IErrorBoundary', {
      serviceClass: null, // Special case - created directly
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: ['IEventBus'],
      options: {}
    })

    // Application services
    this.serviceConfigs.set('IStreamingService', {
      serviceClass: StreamingService,
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: ['IEventBus'],
      options: {}
    })

    this.serviceConfigs.set('IProviderService', {
      serviceClass: AIProviderService,
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: ['IEventBus'],
      options: {}
    })

    this.serviceConfigs.set('ICommandService', {
      serviceClass: InputProcessingService,
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: ['IEventBus'],
      options: {}
    })

    this.serviceConfigs.set('IMCPService', {
      serviceClass: MCPService,
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: ['IEventBus'],
      options: {}
    })
  }

  /**
   * Register external dependencies with the container

   */
  async registerExternalDependencies(externalDependencies) {
    console.log('  📦 Registering external dependencies...')
    
    // Register each external dependency
    for (const [name, instance] of Object.entries(externalDependencies)) {
      this.container.registerInstance(name, instance)
      console.log(`    ✓ Registered external dependency: ${name}`)
    }
  }

  /**
   * Register all services with the DI container
   */
  async registerAllServices() {
    console.log('  🔗 Registering services with DI container...')
    
    // Register EventBus first (special case)
    const eventBus = createEventBus()
    this.container.registerInstance('IEventBus', eventBus)
    console.log('    ✓ Registered IEventBus')

    // Register ErrorBoundary (global instance)
    this.container.registerInstance('IErrorBoundary', errorBoundary)
    console.log('    ✓ Registered IErrorBoundary')

    // Register all other services
    for (const [serviceName, config] of this.serviceConfigs) {
      // Skip special cases already handled
      if (serviceName === 'IEventBus' || serviceName === 'IErrorBoundary') {
        continue
      }

      if (config.serviceClass) {
        this.container.register(
          serviceName,
          (eventBus, logger, ...otherDeps) => {
            const dependencies = { eventBus, logger }
            
            // Add other dependencies by name
            config.dependencies.forEach((depName, index) => {
              if (depName !== 'IEventBus' && index > 0) {
                const depInstance = this.container.tryResolve(depName)
                if (depInstance) {
                  dependencies[this.camelCaseName(depName)] = depInstance
                }
              }
            })
            
            // Add external dependencies
            if (serviceName === 'IMCPService') {
              dependencies.mcpManager = this.container.tryResolve('mcpManager')
              dependencies.intentDetector = this.container.tryResolve('intentDetector')
              dependencies.fetchServer = this.container.tryResolve('fetchServer')
              dependencies.searchServer = this.container.tryResolve('searchServer')
            }
            
            if (serviceName === 'ICommandService') {
              dependencies.commandManagers = {
                system: this.container.tryResolve('systemCommandManager'),
                ai: this.container.tryResolve('aiCommandManager')
              }
            }
            
            return new config.serviceClass(dependencies)
          },
          config.lifetime,
          config.dependencies
        )
        
        console.log(`    ✓ Registered ${serviceName}`)
      }
    }
  }

  /**
   * Initialize core services
   */
  async initializeCoreServices() {
    console.log('  🔄 Initializing core services...')
    
    // Initialize services that need immediate setup
    const coreServices = ['IEventBus', 'IErrorBoundary']
    
    for (const serviceName of coreServices) {
      const service = this.container.tryResolve(serviceName)
      if (service && typeof service.initialize === 'function') {
        await service.initialize()
        console.log(`    ✓ Initialized ${serviceName}`)
      }
    }
  }

  /**
   * Calculate service start order based on dependencies

   */
  calculateStartOrder() {
    const visited = new Set()
    const visiting = new Set()
    const result = []
    
    const visit = (serviceName) => {
      if (visited.has(serviceName)) return
      if (visiting.has(serviceName)) {
        throw createBaseError(`Circular dependency detected involving ${serviceName}`, true, 500)
      }
      
      visiting.add(serviceName)
      
      const config = this.serviceConfigs.get(serviceName)
      if (config && config.dependencies) {
        for (const dep of config.dependencies) {
          visit(dep)
        }
      }
      
      visiting.delete(serviceName)
      visited.add(serviceName)
      result.push(serviceName)
    }
    
    // Visit all services
    for (const serviceName of this.serviceConfigs.keys()) {
      visit(serviceName)
    }
    
    return result
  }

  /**
   * Convert interface name to camelCase property name


   */
  camelCaseName(interfaceName) {
    // Remove 'I' prefix and convert to camelCase
    const name = interfaceName.startsWith('I') ? interfaceName.substring(1) : interfaceName
    return name.charAt(0).toLowerCase() + name.slice(1)
  }

  /**
   * Add custom service to registry


   */
  addService(serviceName, config) {
    if (this.isStarted) {
      throw createBaseError('Cannot add services after registry has started', true, 400)
    }
    
    this.serviceConfigs.set(serviceName, config)
    console.log(`✓ Added custom service: ${serviceName}`)
  }

  /**
   * Remove service from registry


   */
  removeService(serviceName) {
    if (this.isStarted) {
      throw createBaseError('Cannot remove services after registry has started', true, 400)
    }
    
    return this.serviceConfigs.delete(serviceName)
  }

  /**
   * Check if service is registered


   */
  hasService(serviceName) {
    return this.serviceConfigs.has(serviceName)
  }

  /**
   * Get service configuration


   */
  getServiceConfig(serviceName) {
    return this.serviceConfigs.get(serviceName) || null
  }

  /**
   * Get all registered service names

   */
  getServiceNames() {
    return Array.from(this.serviceConfigs.keys())
  }
}

/**
 * Create and configure service registry


 */
export async function createServiceRegistry(externalDependencies = {}) {
  const registry = new ServiceRegistry()
  await registry.initialize(externalDependencies)
  return registry
}

/**
 * Global service registry instance (for convenience)
 * Note: In production, prefer explicit dependency injection
 */
export let globalServiceRegistry = null

/**
 * Initialize global service registry


 */
export async function initializeGlobalRegistry(externalDependencies = {}) {
  if (globalServiceRegistry) {
    console.warn('Global service registry already initialized')
    return globalServiceRegistry
  }
  
  globalServiceRegistry = await createServiceRegistry(externalDependencies)
  await globalServiceRegistry.start()
  
  return globalServiceRegistry
}

/**
 * Shutdown global service registry

 */
export async function shutdownGlobalRegistry() {
  if (globalServiceRegistry) {
    await globalServiceRegistry.shutdown()
    globalServiceRegistry = null
  }
}