import { BaseRequestHandler } from './base-handler.js'
import { AppError } from '../utils/error-handler.js'
import { color } from '../config/color.js'

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
    // Skip cache if force flag is set
    if (context.flags?.force) {
      this.log('info', 'Cache bypassed due to force flag')
      return this.createPassThrough(context.processedInput, {
        cacheChecked: false,
        cacheBypassed: true,
        reason: 'force_flag'
      })
    }
    
    try {
      // Check different cache types based on context
      const cacheResult = await this.checkCache(context)
      
      if (cacheResult.found) {
        this.log('info', `Cache hit: ${cacheResult.type}`)
        
        // Update statistics
        this.updateCacheStats('hit', cacheResult.type)
        this.lastCacheOperation = new Date()
        
        // Show cached response
        this.showCachedResponse(cacheResult)
        
        // Emit cache hit event
        this.emitEvent('cache:hit', {
          type: cacheResult.type,
          key: cacheResult.key,
          size: cacheResult.data ? cacheResult.data.length : 0
        })
        
        // Stop chain - request fulfilled from cache
        return this.createResult(cacheResult.data, { 
          stopChain: true,
          metadata: {
            fromCache: true,
            cacheType: cacheResult.type,
            cacheKey: cacheResult.key
          }
        })
      } else {
        this.log('debug', `Cache miss: ${cacheResult.type}`)
        
        // Update statistics
        this.updateCacheStats('miss', cacheResult.type || 'unknown')
        
        // Continue chain but mark cache info for later storage
        context.cacheInfo = {
          type: cacheResult.type,
          key: cacheResult.key,
          shouldCache: true
        }
        
        return this.createPassThrough(context.processedInput, {
          cacheChecked: true,
          cacheFound: false,
          cacheType: cacheResult.type,
          cacheKey: cacheResult.key
        })
      }
      
    } catch (error) {
      this.log('error', `Cache operation failed: ${error.message}`)
      
      // Update error statistics
      this.updateCacheStats('error', 'unknown', error.message)
      
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
   * Check cache for different request types
   * @private
   * @param {Object} context - Processing context
   * @returns {Promise<Object>} Cache check result
   */
  async checkCache(context) {
    // Determine cache type and key
    const cacheInfo = this.determineCacheInfo(context)
    
    if (!cacheInfo.key) {
      return {
        found: false,
        type: cacheInfo.type,
        key: null,
        data: null
      }
    }
    
    this.log('debug', `Checking ${cacheInfo.type} cache: ${cacheInfo.key.substring(0, 50)}...`)
    
    // Check appropriate cache type
    switch (cacheInfo.type) {
      case 'translation':
        return await this.checkTranslationCache(cacheInfo.key)
        
      case 'multi-provider':
        return await this.checkMultiProviderCache(cacheInfo.key)
        
      case 'document':
        return await this.checkDocumentCache(cacheInfo.key)
        
      case 'multi-command':
        return await this.checkMultiCommandCache(cacheInfo.key)
        
      default:
        return await this.checkGeneralCache(cacheInfo.key)
    }
  }

  /**
   * Determine cache type and key from context
   * @private
   * @param {Object} context - Processing context
   * @returns {Object} Cache info
   */
  determineCacheInfo(context) {
    const instruction = context.instructionInfo
    const command = context.command
    
    // Multi-command cache (multiple models)
    if (command?.models && Array.isArray(command.models) && command.models.length > 1) {
      return {
        type: 'multi-command',
        key: this.generateCacheKey(context.processedInput)
      }
    }
    
    // Multi-provider translation cache
    if (instruction?.isMultiProvider && !instruction?.models?.length) {
      return {
        type: 'multi-provider',
        key: this.generateCacheKey(context.processedInput)
      }
    }
    
    // Document translation cache
    if (instruction?.isDocCommand) {
      return {
        type: 'document',
        key: this.generateCacheKey(context.processedInput)
      }
    }
    
    // Regular translation cache
    if (instruction?.isTranslation) {
      const cacheKey = instruction.hasUrl ? instruction.originalInput : instruction.fullInstruction
      return {
        type: 'translation',
        key: this.generateCacheKey(cacheKey)
      }
    }
    
    // General cache for other requests
    return {
      type: 'general',
      key: this.generateCacheKey(context.processedInput)
    }
  }

  /**
   * Generate cache key from input
   * @private
   * @param {string} input - Input string
   * @returns {string} Cache key
   */
  generateCacheKey(input) {
    if (!input || typeof input !== 'string') {
      return null
    }
    
    // Simple cache key generation - in production, might use hash
    return input.trim().toLowerCase()
  }

  /**
   * Check translation cache
   * @private
   * @param {string} key - Cache key
   * @returns {Promise<Object>} Cache result
   */
  async checkTranslationCache(key) {
    if (!this.cache.has) {
      return { found: false, type: 'translation', key, data: null }
    }
    
    const cached = this.cache.has(key) ? this.cache.get(key) : null
    
    return {
      found: !!cached,
      type: 'translation',
      key,
      data: cached
    }
  }

  /**
   * Check multi-provider cache
   * @private
   * @param {string} key - Cache key
   * @returns {Promise<Object>} Cache result
   */
  async checkMultiProviderCache(key) {
    if (!this.cache.hasMultipleResponses) {
      return { found: false, type: 'multi-provider', key, data: null }
    }
    
    const cached = this.cache.hasMultipleResponses(key) ? 
      this.cache.getMultipleResponses(key) : null
    
    return {
      found: !!cached,
      type: 'multi-provider',
      key,
      data: cached
    }
  }

  /**
   * Check document cache
   * @private
   * @param {string} key - Cache key
   * @returns {Promise<Object>} Cache result
   */
  async checkDocumentCache(key) {
    if (!this.cache.getDocumentFile) {
      return { found: false, type: 'document', key, data: null }
    }
    
    const cached = this.cache.getDocumentFile(key)
    
    return {
      found: !!cached,
      type: 'document',
      key,
      data: cached
    }
  }

  /**
   * Check multi-command cache
   * @private
   * @param {string} key - Cache key
   * @returns {Promise<Object>} Cache result
   */
  async checkMultiCommandCache(key) {
    // Use multi-provider cache infrastructure for multi-command
    return await this.checkMultiProviderCache(key)
  }

  /**
   * Check general cache
   * @private
   * @param {string} key - Cache key
   * @returns {Promise<Object>} Cache result
   */
  async checkGeneralCache(key) {
    // Use translation cache infrastructure for general caching
    return await this.checkTranslationCache(key)
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
   * Update cache statistics
   * @private
   * @param {string} operation - Operation type (hit, miss, error)
   * @param {string} cacheType - Cache type
   * @param {string} error - Error message if operation failed
   */
  updateCacheStats(operation, cacheType, error = null) {
    const key = `${operation}:${cacheType}`
    const current = this.cacheStats.get(key) || {
      count: 0,
      lastOperation: null,
      errors: []
    }
    
    current.count++
    current.lastOperation = new Date()
    
    if (operation === 'error' && error && current.errors.length < 3) {
      current.errors.push({
        error,
        timestamp: new Date()
      })
    }
    
    this.cacheStats.set(key, current)
  }

  /**
   * Get cache operation statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const stats = {
      totalOperations: 0,
      hits: 0,
      misses: 0,
      errors: 0,
      lastOperation: this.lastCacheOperation,
      breakdown: {}
    }
    
    for (const [key, data] of this.cacheStats) {
      const [operation, type] = key.split(':')
      
      stats.totalOperations += data.count
      
      switch (operation) {
        case 'hit':
          stats.hits += data.count
          break
        case 'miss':
          stats.misses += data.count
          break
        case 'error':
          stats.errors += data.count
          break
      }
      
      stats.breakdown[key] = { ...data }
    }
    
    stats.hitRate = (stats.hits + stats.misses) > 0 ? 
      (stats.hits / (stats.hits + stats.misses)) * 100 : 0
    
    return stats
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
    const cacheStats = this.getCacheStats()
    const serviceStatus = this.getCacheServiceStatus()
    
    return {
      ...baseStats,
      cacheOperations: cacheStats,
      cacheService: serviceStatus
    }
  }

  /**
   * @override
   */
  getHealthStatus() {
    const baseHealth = super.getHealthStatus()
    const cacheStats = this.getCacheStats()
    const serviceStatus = this.getCacheServiceStatus()
    
    return {
      ...baseHealth,
      cacheHealth: {
        hasCacheService: !!this.cache,
        isServiceAvailable: serviceStatus.available,
        totalOperations: cacheStats.totalOperations,
        hitRate: cacheStats.hitRate,
        recentErrors: cacheStats.errors,
        lastOperation: this.lastCacheOperation,
        supportedTypes: serviceStatus.supportedTypes?.length || 0,
        isHealthy: serviceStatus.available && cacheStats.hitRate > 20 // Healthy if >20% hit rate
      }
    }
  }

  /**
   * Clear cache statistics
   */
  clearStats() {
    this.cacheStats.clear()
    this.lastCacheOperation = null
    this.log('info', 'Cache statistics cleared')
  }

  /**
   * @override
   */
  dispose() {
    super.dispose()
    this.cacheStats.clear()
    this.lastCacheOperation = null
  }
}