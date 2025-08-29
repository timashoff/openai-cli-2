import { ClipboardHandler } from './clipboard-handler.js'
import { FlagHandler } from './flag-handler.js'
import { CommandHandler } from './command-handler.js'
import { MCPHandler } from './mcp-handler.js'
import { CacheHandler } from './cache-handler.js'
import { StreamHandler } from './stream-handler.js'

/**
 * Factory for creating and configuring request processing handler chains
 * Implements Chain of Responsibility pattern with proper ordering
 */
export class HandlerChainFactory {
  /**
   * Create the standard request processing chain


   */
  static createRequestChain(dependencies) {
    // Verify required dependencies
    const requiredDeps = [
      'eventBus', 'logger'
    ]
    
    // Optional dependencies (will work without them but with reduced functionality)
    const optionalDeps = ['errorBoundary']
    
    const missing = requiredDeps.filter(dep => !dependencies[dep])
    if (missing.length > 0) {
      throw new Error(`Missing required dependencies: ${missing.join(', ')}`)
    }
    
    // Warn about missing optional dependencies
    const missingOptional = optionalDeps.filter(dep => !dependencies[dep])
    if (missingOptional.length > 0) {
      console.warn(`Handler chain: Optional dependencies missing: ${missingOptional.join(', ')} - some features may be limited`)
    }

    // Full handler chain - ACTIVATED for Phase 4.2
    const handlers = [
      // 1. Process clipboard markers first (modifies input)
      new ClipboardHandler(dependencies),
      
      // 2. Process flags (force, etc.)
      new FlagHandler(dependencies), 
      
      // 3. Process commands - CRITICAL for translation functionality (aa, rr, etc.)
      new CommandHandler(dependencies),
      
      // 4. Handle MCP (web content, search, etc.)
      new MCPHandler(dependencies),
      
      // 5. Check cache for responses
      new CacheHandler(dependencies),
      
      // 6. Final AI streaming (always handles remaining requests) 
      new StreamHandler(dependencies)
    ]

    // Link handlers in chain
    for (let i = 0; i < handlers.length - 1; i++) {
      handlers[i].setNext(handlers[i + 1])
    }

    return handlers
  }

  /**
   * Create a minimal chain for testing or specific use cases



   */
  static createCustomChain(dependencies, handlerTypes) {
    const handlerMap = {
      clipboard: ClipboardHandler,
      flag: FlagHandler,
      command: CommandHandler,
      mcp: MCPHandler,
      cache: CacheHandler,
      stream: StreamHandler
    }

    const handlers = handlerTypes.map(type => {
      const HandlerClass = handlerMap[type]
      if (!HandlerClass) {
        throw new Error(`Unknown handler type: ${type}`)
      }
      return new HandlerClass(dependencies)
    })

    // Link handlers in chain
    for (let i = 0; i < handlers.length - 1; i++) {
      handlers[i].setNext(handlers[i + 1])
    }

    return handlers
  }

  /**
   * Validate handler chain configuration


   */
  static validateChain(handlers) {
    if (!Array.isArray(handlers) || handlers.length === 0) {
      return {
        valid: false,
        error: 'Handler chain must be a non-empty array'
      }
    }

    // Check that all handlers extend BaseRequestHandler
    const invalidHandlers = handlers.filter((handler, index) => {
      return !handler.canHandle || !handler.process || typeof handler.canHandle !== 'function'
    })

    if (invalidHandlers.length > 0) {
      return {
        valid: false,
        error: `Invalid handlers found: ${invalidHandlers.length} handlers missing required methods`
      }
    }

    // Check chain linkage
    const brokenLinks = []
    for (let i = 0; i < handlers.length - 1; i++) {
      if (!handlers[i].nextHandler || handlers[i].nextHandler !== handlers[i + 1]) {
        brokenLinks.push(i)
      }
    }

    if (brokenLinks.length > 0) {
      return {
        valid: false,
        error: `Broken chain links at positions: ${brokenLinks.join(', ')}`
      }
    }

    // Ensure final handler can always handle (StreamHandler requirement)
    const finalHandler = handlers[handlers.length - 1]
    if (finalHandler.constructor.name !== 'StreamHandler') {
      return {
        valid: false,
        error: 'Final handler must be StreamHandler to ensure all requests are handled'
      }
    }

    return {
      valid: true,
      handlerCount: handlers.length,
      handlerTypes: handlers.map(h => h.constructor.name)
    }
  }

  /**
   * Get handler statistics from chain


   */
  static getChainStats(handlers) {
    const stats = {
      totalHandlers: handlers.length,
      handlerTypes: {},
      combinedStats: {}
    }

    handlers.forEach(handler => {
      const handlerName = handler.constructor.name
      stats.handlerTypes[handlerName] = (stats.handlerTypes[handlerName] || 0) + 1
      
      if (typeof handler.getStats === 'function') {
        stats.combinedStats[handlerName] = handler.getStats()
      }
    })

    return stats
  }

  /**
   * Get health status from chain


   */
  static getChainHealth(handlers) {
    const health = {
      totalHandlers: handlers.length,
      healthyHandlers: 0,
      unhealthyHandlers: 0,
      handlerHealth: {}
    }

    handlers.forEach(handler => {
      const handlerName = handler.constructor.name
      
      if (typeof handler.getHealthStatus === 'function') {
        const handlerHealth = handler.getHealthStatus()
        health.handlerHealth[handlerName] = handlerHealth
        
        // Simple health check - assumes handler is healthy if no explicit isHealthy field
        const isHealthy = handlerHealth.isHealthy !== false
        if (isHealthy) {
          health.healthyHandlers++
        } else {
          health.unhealthyHandlers++
        }
      } else {
        health.healthyHandlers++
      }
    })

    health.overallHealthy = health.unhealthyHandlers === 0

    return health
  }

  /**
   * Dispose of all handlers in chain

   */
  static disposeChain(handlers) {
    handlers.forEach(handler => {
      if (typeof handler.dispose === 'function') {
        handler.dispose()
      }
    })
  }
}