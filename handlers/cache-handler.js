import { BaseRequestHandler } from './base-handler.js'
import { AppError } from '../utils/error-handler.js'
import { color } from '../config/color.js'
import cacheManager from '../core/CacheManager.js'

/**
 * Handler for cache operations (checking and bypassing cache)
 * Handles translation caches, multi-provider caches, and document caches
 */
export class CacheHandler extends BaseRequestHandler {
  constructor(dependencies) {
    super(dependencies)
    
    /** @type {Object} */
    this.cache = dependencies.cache
    /** @type {Map<string, number>} */
    this.cacheStats = new Map()
    /** @type {Date} */
    this.lastCacheOperation = null
  }

  /**
   * @override
   */
  async canHandle(context) {
    if (!this.cache) {
      return false
    }
    
    // Can handle if we have instruction info or it's a potential cached request
    return !!(context.instructionInfo || 
             context.command?.isTranslation || 
             context.command?.isMultiProvider ||
             context.command?.isDocCommand ||
             this.isPotentiallyCacheable(context.processedInput))
  }

  /**
   * @override
   */
  async process(context) {
    try {
      const command = context.command
      const instruction = context.instructionInfo
      const forceRequest = context.flags?.force || false
      
      // Use CacheManager to determine if we should cache
      const cacheDecision = cacheManager.shouldCache(command, instruction, forceRequest)
      
      if (!cacheDecision.shouldUse) {
        this.log('info', `Cache bypassed: ${cacheDecision.reason}`)
        return this.createPassThrough(context.processedInput, {
          cacheChecked: false,
          cacheBypassed: true,
          reason: cacheDecision.reason
        })
      }
      
      // Generate cache key using CacheManager
      const cacheKey = cacheManager.generateCacheKey(context.processedInput, command)
      cacheDecision.cacheKey = cacheKey
      
      // Check if we have cached response
      const hasCached = await this.checkCachedResponse(cacheKey, command)
      
      if (hasCached.found) {
        this.log('info', `Cache hit: ${hasCached.type}`)
        
        // Show cached response
        this.showCachedResponse(hasCached)
        
        // Emit cache hit event
        this.emitEvent('cache:hit', {
          type: hasCached.type,
          key: cacheKey,
          size: hasCached.data ? String(hasCached.data).length : 0
        })
        
        // Stop chain - request fulfilled from cache
        return this.createResult(hasCached.data, { 
          stopChain: true,
          metadata: {
            fromCache: true,
            cacheType: hasCached.type,
            cacheKey: cacheKey
          }
        })
      } else {
        this.log('debug', `Cache miss: ${hasCached.type || 'general'}`)
        
        // Continue chain but mark cache info for later storage
        context.cacheInfo = {
          cacheDecision: cacheDecision,
          key: cacheKey,
          shouldCache: cacheDecision.shouldStore
        }
        
        return this.createPassThrough(context.processedInput, {
          cacheChecked: true,
          cacheFound: false,
          cacheKey: cacheKey
        })
      }
      
    } catch (error) {
      this.log('error', `Cache operation failed: ${error.message}`)
      
      // Emit error event
      this.emitEvent('cache:error', {
        error: error.message,
        operation: 'check'
      })
      
      // Continue chain on cache errors - don't block processing
      return this.createPassThrough(context.processedInput, {
        cacheChecked: false,
        cacheError: error.message
      })
    }
  }

  /**
   * Check if we have cached response using CacheManager
   * @private
   * @param {string} cacheKey - Cache key
   * @param {Object} command - Command object
   * @returns {Promise<Object>} Cache check result
   */
  async checkCachedResponse(cacheKey, command) {
    if (!cacheKey) {
      return {
        found: false,
        type: 'general',
        key: cacheKey,
        data: null
      }
    }
    
    this.log('debug', `Checking cache: ${cacheKey.substring(0, 50)}...`)
    
    // Check if it's a multi-model command
    const isMultiModel = command?.models && Array.isArray(command.models) && command.models.length > 1
    
    if (isMultiModel) {
      // Check multi-provider cache
      const hasCache = await cacheManager.hasMultipleResponses(cacheKey)
      if (hasCache) {
        const cachedData = await cacheManager.getMultipleResponses(cacheKey)
        return {
          found: true,
          type: 'multi-command',
          key: cacheKey,
          data: cachedData
        }
      }
    } else {
      // Check regular cache
      const hasCache = await cacheManager.hasCache(cacheKey)
      if (hasCache) {
        const cachedData = await cacheManager.getCache(cacheKey)
        return {
          found: true,
          type: 'general',
          key: cacheKey,
          data: cachedData
        }
      }
    }
    
    return {
      found: false,
      type: isMultiModel ? 'multi-command' : 'general',
      key: cacheKey,
      data: null
    }
  }


  /**
   * Show cached response to user
   * @private
   * @param {Object} cacheResult - Cache result
   */
  showCachedResponse(cacheResult) {
    console.log(`${color.yellow}[from cache]${color.reset}`)
    
    // Handle different cache data formats
    switch (cacheResult.type) {
      case 'translation':
      case 'general':
        if (typeof cacheResult.data === 'string') {
          process.stdout.write(cacheResult.data + '\n')
        }
        break
        
      case 'multi-provider':
      case 'multi-command':
        if (Array.isArray(cacheResult.data)) {
          // Format multi-provider response
          this.showMultiProviderCachedResponse(cacheResult.data)
        }
        break
        
      case 'document':
        if (cacheResult.data?.content) {
          process.stdout.write(cacheResult.data.content + '\n')
          // Show file info if available
          if (cacheResult.data.file) {
            console.log(`${color.green}✓ Document saved: ${cacheResult.data.file.name}${color.reset}`)
          }
        }
        break
    }
  }

  /**
   * Show multi-provider cached response
   * @private
   * @param {Array} responses - Cached responses
   */
  showMultiProviderCachedResponse(responses) {
    // This would format the multi-provider response similar to the original
    // For now, just show basic info
    const successful = responses.filter(r => r.response && !r.error).length
    const total = responses.length
    
    console.log(`${color.grey}[Multi-provider cache: ${successful}/${total} responses]${color.reset}`)
    
    // Show individual responses
    responses.forEach(response => {
      if (response.response) {
        const providerLabel = response.model ? 
          `${response.provider} (${response.model})` : 
          response.provider
        console.log(`\n${color.cyan}${providerLabel}${color.reset}:`)
        process.stdout.write(response.response + '\n')
      } else if (response.error) {
        console.log(`${color.red}${response.provider}: ${response.error}${color.reset}`)
      }
    })
  }

  /**
   * Check if input is potentially cacheable
   * @private
   * @param {string} input - Input string
   * @returns {boolean} True if potentially cacheable
   */
  isPotentiallyCacheable(input) {
    // Simple heuristics for cacheable content
    const cacheablePatterns = [
      /translate/i,
      /перевод/i,
      /grammar/i,
      /grammar/i,
      /doc\s/i,
      /https?:\/\//i
    ]
    
    return cacheablePatterns.some(pattern => pattern.test(input))
  }


  /**
   * Get cache service status
   * @returns {Object} Cache service status
   */
  getCacheServiceStatus() {
    if (!this.cache) {
      return {
        available: false,
        reason: 'Cache service not available'
      }
    }
    
    const methods = [
      'has', 'get', 'set',
      'hasMultipleResponses', 'getMultipleResponses', 'setMultipleResponses',
      'getDocumentFile', 'setDocumentFile'
    ]
    
    const availableMethods = methods.filter(method => 
      typeof this.cache[method] === 'function'
    )
    
    return {
      available: true,
      supportedOperations: availableMethods,
      totalMethods: methods.length,
      supportedTypes: this.getSupportedCacheTypes()
    }
  }

  /**
   * Get supported cache types
   * @private
   * @returns {string[]} Supported cache types
   */
  getSupportedCacheTypes() {
    const types = ['general']
    
    if (this.cache?.hasMultipleResponses) {
      types.push('multi-provider', 'multi-command')
    }
    
    if (this.cache?.getDocumentFile) {
      types.push('document')
    }
    
    if (this.cache?.has) {
      types.push('translation')
    }
    
    return types
  }

  /**
   * @override
   */
  getStats() {
    const baseStats = super.getStats()
    const cacheManagerStats = cacheManager.getStats()
    const serviceStatus = this.getCacheServiceStatus()
    
    return {
      ...baseStats,
      cacheOperations: cacheManagerStats,
      cacheService: serviceStatus
    }
  }

  /**
   * @override
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    const cacheManagerStats = cacheManager.getStats()
    const serviceStatus = this.getCacheServiceStatus()
    
    return {
      ...baseHealth,
      cacheHealth: {
        hasCacheService: !!this.cache,
        isServiceAvailable: serviceStatus.available,
        cacheManagerStats: cacheManagerStats,
        supportedTypes: serviceStatus.supportedTypes?.length || 0,
        isHealthy: serviceStatus.available // CacheManager handles health internally
      }
    }
  }

  /**
   * Clear cache statistics
   */
  clearStats() {
    cacheManager.resetStats()
    this.log('info', 'Cache statistics cleared')
  }

  /**
   * @override
   */
  dispose() {
    super.dispose()
    // CacheManager is singleton, no need to dispose
  }
}