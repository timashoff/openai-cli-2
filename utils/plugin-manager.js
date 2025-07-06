import { AppError } from './error-handler.js'
import { logger } from './logger.js'
import { validateString, validateObject } from './validation.js'

/**
 * Plugin system for extending CLI functionality
 */
export class PluginManager {
  constructor() {
    this.plugins = new Map()
    this.hooks = new Map()
    this.middlewares = []
    this.initialized = false
  }

  /**
   * Register a plugin
   */
  registerPlugin(pluginName, plugin) {
    try {
      validateString(pluginName, 'pluginName')
      validateObject(plugin, 'plugin')
      
      if (this.plugins.has(pluginName)) {
        throw new AppError(`Plugin ${pluginName} is already registered`, true, 400)
      }
      
      // Validate plugin structure
      if (typeof plugin.init !== 'function') {
        throw new AppError(`Plugin ${pluginName} must have an init function`, true, 400)
      }
      
      this.plugins.set(pluginName, {
        ...plugin,
        name: pluginName,
        active: false
      })
      
      logger.debug(`Plugin ${pluginName} registered successfully`)
    } catch (error) {
      logger.error(`Failed to register plugin ${pluginName}:`, error.message)
      throw error
    }
  }

  /**
   * Initialize a plugin
   */
  async initializePlugin(pluginName) {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      throw new AppError(`Plugin ${pluginName} not found`, true, 404)
    }
    
    if (plugin.active) {
      return true
    }
    
    try {
      await plugin.init(this)
      plugin.active = true
      logger.debug(`Plugin ${pluginName} initialized successfully`)
      return true
    } catch (error) {
      logger.error(`Failed to initialize plugin ${pluginName}:`, error.message)
      throw error
    }
  }

  /**
   * Initialize all plugins
   */
  async initializeAll() {
    const initPromises = Array.from(this.plugins.keys()).map(name => 
      this.initializePlugin(name).catch(error => {
        logger.error(`Plugin ${name} initialization failed:`, error.message)
        return false
      })
    )
    
    await Promise.all(initPromises)
    this.initialized = true
    logger.debug('All plugins initialized')
  }

  /**
   * Deactivate a plugin
   */
  async deactivatePlugin(pluginName) {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      throw new AppError(`Plugin ${pluginName} not found`, true, 404)
    }
    
    if (!plugin.active) {
      return true
    }
    
    try {
      if (typeof plugin.destroy === 'function') {
        await plugin.destroy()
      }
      plugin.active = false
      logger.debug(`Plugin ${pluginName} deactivated successfully`)
      return true
    } catch (error) {
      logger.error(`Failed to deactivate plugin ${pluginName}:`, error.message)
      throw error
    }
  }

  /**
   * Register a hook
   */
  registerHook(hookName, callback) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, [])
    }
    
    this.hooks.get(hookName).push(callback)
    logger.debug(`Hook ${hookName} registered`)
  }

  /**
   * Execute all callbacks for a hook
   */
  async executeHook(hookName, ...args) {
    const callbacks = this.hooks.get(hookName) || []
    
    if (callbacks.length === 0) {
      return args
    }
    
    let result = args
    for (const callback of callbacks) {
      try {
        result = await callback(...result) || result
      } catch (error) {
        logger.error(`Hook ${hookName} callback failed:`, error.message)
      }
    }
    
    return result
  }

  /**
   * Register middleware
   */
  registerMiddleware(middleware) {
    if (typeof middleware !== 'function') {
      throw new AppError('Middleware must be a function', true, 400)
    }
    
    this.middlewares.push(middleware)
    logger.debug('Middleware registered')
  }

  /**
   * Execute all middlewares
   */
  async executeMiddlewares(context) {
    let result = context
    
    for (const middleware of this.middlewares) {
      try {
        result = await middleware(result) || result
      } catch (error) {
        logger.error('Middleware execution failed:', error.message)
        throw error
      }
    }
    
    return result
  }

  /**
   * Get plugin by name
   */
  getPlugin(pluginName) {
    return this.plugins.get(pluginName)
  }

  /**
   * Get all active plugins
   */
  getActivePlugins() {
    return Array.from(this.plugins.values()).filter(plugin => plugin.active)
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins() {
    return Array.from(this.plugins.values())
  }

  /**
   * Check if plugin is active
   */
  isPluginActive(pluginName) {
    const plugin = this.plugins.get(pluginName)
    return plugin ? plugin.active : false
  }

  /**
   * Remove a plugin
   */
  async removePlugin(pluginName) {
    const plugin = this.plugins.get(pluginName)
    if (!plugin) {
      return false
    }
    
    if (plugin.active) {
      await this.deactivatePlugin(pluginName)
    }
    
    this.plugins.delete(pluginName)
    logger.debug(`Plugin ${pluginName} removed`)
    return true
  }

  /**
   * Get plugin statistics
   */
  getStats() {
    const allPlugins = this.getAllPlugins()
    const activePlugins = this.getActivePlugins()
    
    return {
      total: allPlugins.length,
      active: activePlugins.length,
      inactive: allPlugins.length - activePlugins.length,
      hooks: this.hooks.size,
      middlewares: this.middlewares.length
    }
  }
}

// Export singleton instance
export const pluginManager = new PluginManager()