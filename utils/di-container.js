import { AppError } from './error-handler.js'

/**
 * Service lifetime enumeration
 */
export const ServiceLifetime = {
  /** New instance created each time */
  TRANSIENT: 'transient',
  /** Single instance shared across application */
  SINGLETON: 'singleton',
  /** Instance created once per scope */
  SCOPED: 'scoped'
}

/**
 * Service registration descriptor
 */

/**
 * Modern Dependency Injection Container with proper lifecycle management,
 * circular dependency detection, and interface-based registration
 */
export class DIContainer {
  constructor() {
    /** @type {Map<string, ServiceDescriptor>} */
    this.services = new Map()
    /** @type {Map<string, any>} */
    this.singletonInstances = new Map()
    /** @type {Map<string, any>} */
    this.scopedInstances = new Map()
    /** @type {Set<string>} */
    this.resolutionStack = new Set()
    /** @type {boolean} */
    this.isDisposed = false
  }

  /**
   * Register a service with the container





   * container.register('ILogger', () => new ConsoleLogger(), ServiceLifetime.SINGLETON)
   * container.register('ICache', CacheService, ServiceLifetime.SINGLETON, ['ILogger'])
   */
  register(name, factory, lifetime = ServiceLifetime.TRANSIENT, dependencies = []) {
    this.validateRegistration(name, factory, lifetime, dependencies)

    this.services.set(name, {
      name,
      factory,
      lifetime,
      dependencies: [...dependencies], // Create defensive copy
      instance: null
    })

    return this
  }

  /**
   * Register a singleton service




   */
  registerSingleton(name, factory, dependencies = []) {
    return this.register(name, factory, ServiceLifetime.SINGLETON, dependencies)
  }

  /**
   * Register a transient service




   */
  registerTransient(name, factory, dependencies = []) {
    return this.register(name, factory, ServiceLifetime.TRANSIENT, dependencies)
  }

  /**
   * Register an existing instance as singleton



   */
  registerInstance(name, instance) {
    this.validateName(name)
    
    if (instance === null || instance === undefined) {
      throw new AppError(`Instance cannot be null or undefined for service '${name}'`, true, 400)
    }

    this.services.set(name, {
      name,
      factory: () => instance,
      lifetime: ServiceLifetime.SINGLETON,
      dependencies: [],
      instance
    })

    this.singletonInstances.set(name, instance)
    return this
  }

  /**
   * Resolve a service from the container



   */
  resolve(name) {
    if (this.isDisposed) {
      throw new AppError('Cannot resolve services from disposed container', true, 500)
    }

    return this.resolveInternal(name)
  }

  /**
   * Try to resolve a service, returning null if not found


   */
  tryResolve(name) {
    try {
      return this.resolve(name)
    } catch (error) {
      if (error.message && error.message.includes('not registered')) {
        return null
      }
      throw error
    }
  }

  /**
   * Check if a service is registered


   */
  isRegistered(name) {
    return this.services.has(name)
  }

  /**
   * Get all registered service names

   */
  getRegisteredServices() {
    return Array.from(this.services.keys())
  }

  /**
   * Create a new scope for scoped services

   */
  createScope() {
    const scopedContainer = Object.create(this)
    scopedContainer.scopedInstances = new Map()
    return scopedContainer
  }

  /**
   * Dispose the container and cleanup resources
   */
  dispose() {
    if (this.isDisposed) return

    // Dispose singleton instances that implement IDisposable
    for (const [name, instance] of this.singletonInstances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          instance.dispose()
        } catch (error) {
          console.error(`Error disposing service '${name}':`, error.message)
        }
      }
    }

    this.services.clear()
    this.singletonInstances.clear()
    this.scopedInstances.clear()
    this.resolutionStack.clear()
    this.isDisposed = true
  }

  /**
   * Internal service resolution with circular dependency detection


   */
  resolveInternal(name) {
    // Check for circular dependency
    if (this.resolutionStack.has(name)) {
      const cycle = Array.from(this.resolutionStack).join(' -> ') + ` -> ${name}`
      throw new AppError(`Circular dependency detected: ${cycle}`, true, 500)
    }

    const descriptor = this.services.get(name)
    if (!descriptor) {
      throw new AppError(`Service '${name}' is not registered`, true, 404)
    }

    // Return existing singleton instance
    if (descriptor.lifetime === ServiceLifetime.SINGLETON && this.singletonInstances.has(name)) {
      return this.singletonInstances.get(name)
    }

    // Return existing scoped instance  
    if (descriptor.lifetime === ServiceLifetime.SCOPED && this.scopedInstances.has(name)) {
      return this.scopedInstances.get(name)
    }

    // Add to resolution stack for circular dependency detection
    this.resolutionStack.add(name)

    try {
      // Resolve dependencies
      const dependencies = descriptor.dependencies.map(dep => this.resolveInternal(dep))
      
      // Create instance
      const instance = this.createInstance(descriptor, dependencies)

      // Cache if needed
      if (descriptor.lifetime === ServiceLifetime.SINGLETON) {
        this.singletonInstances.set(name, instance)
      } else if (descriptor.lifetime === ServiceLifetime.SCOPED) {
        this.scopedInstances.set(name, instance)
      }

      return instance
    } finally {
      // Remove from resolution stack
      this.resolutionStack.delete(name)
    }
  }

  /**
   * Create service instance using factory



   */
  createInstance(descriptor, dependencies) {
    try {
      // If factory is a constructor function, use 'new'
      if (this.isConstructorFunction(descriptor.factory)) {
        return new descriptor.factory(...dependencies)
      }
      
      // Otherwise, call as regular function
      return descriptor.factory(...dependencies)
    } catch (error) {
      throw new AppError(
        `Error creating instance of service '${descriptor.name}': ${error.message}`,
        true,
        500
      )
    }
  }

  /**
   * Check if function is a constructor


   */
  isConstructorFunction(func) {
    // Check if function has prototype properties (typical for constructors)
    return func.prototype && func.prototype.constructor === func
  }

  /**
   * Validate service registration parameters
   */
  validateRegistration(name, factory, lifetime, dependencies) {
    this.validateName(name)

    if (typeof factory !== 'function') {
      throw new AppError(`Factory must be a function for service '${name}'`, true, 400)
    }

    if (!Object.values(ServiceLifetime).includes(lifetime)) {
      throw new AppError(`Invalid service lifetime '${lifetime}' for service '${name}'`, true, 400)
    }

    if (!Array.isArray(dependencies)) {
      throw new AppError(`Dependencies must be an array for service '${name}'`, true, 400)
    }

    for (const dep of dependencies) {
      this.validateName(dep, 'dependency')
    }
  }

  /**
   * Validate service name


   */
  validateName(name, type = 'service name') {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw new AppError(`Invalid ${type}: must be non-empty string`, true, 400)
    }
  }

  /**
   * Get container statistics for debugging

   */
  getStats() {
    return {
      totalServices: this.services.size,
      singletonInstances: this.singletonInstances.size,
      scopedInstances: this.scopedInstances.size,
      isDisposed: this.isDisposed,
      services: Array.from(this.services.entries()).map(([name, descriptor]) => ({
        name,
        lifetime: descriptor.lifetime,
        dependencies: descriptor.dependencies,
        hasInstance: this.singletonInstances.has(name) || this.scopedInstances.has(name)
      }))
    }
  }
}

/**
 * Create a new DIContainer instance

 */
export function createContainer() {
  return new DIContainer()
}

// Global container instance for application-wide services
export const globalContainer = createContainer()