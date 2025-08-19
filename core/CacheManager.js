/**
 * CacheManager - Centralized cache logic following Single Source of Truth principle
 * Consolidates all caching decisions from 5 different files into one place
 * Replaces scattered cache_enabled checks across the codebase
 */
import cache from '../utils/cache.js'
import { logger } from '../utils/logger.js'

export class CacheManager {
  constructor() {
    this.logger = logger
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      cacheSkips: 0, // When caching disabled
      forceSkips: 0  // When force flags used
    }
  }

  /**
   * Determine if request should be cached based on command and force flags
   * Single source of truth for all cache decisions
   * @param {Object} command - Command object with cache_enabled field
   * @param {Object} instruction - Instruction object (optional)
   * @param {boolean} forceRequest - Force flag to bypass cache
   * @returns {Object} Cache decision and metadata
   */
  shouldCache(command, instruction = null, forceRequest = false) {
    // Force flags always skip cache
    if (forceRequest) {
      this.stats.forceSkips++
      this.logger.debug('CacheManager: Cache skipped due to force flag')
      return {
        shouldUse: false,
        shouldStore: false,
        reason: 'force_flag',
        cacheKey: null
      }
    }

    // Check cache_enabled on command first (primary source)
    const commandCacheEnabled = command?.cache_enabled !== false
    
    // Check cache_enabled on instruction as fallback
    const instructionCacheEnabled = instruction?.cache_enabled !== false
    
    // Cache is enabled if either command or instruction allows it
    const cacheEnabled = commandCacheEnabled && instructionCacheEnabled
    
    if (!cacheEnabled) {
      this.stats.cacheSkips++
      this.logger.debug('CacheManager: Cache disabled by command/instruction cache_enabled=false')
      return {
        shouldUse: false,
        shouldStore: false,
        reason: 'cache_disabled',
        cacheKey: null
      }
    }

    this.logger.debug('CacheManager: Cache enabled for this request')
    return {
      shouldUse: true,
      shouldStore: true, 
      reason: 'cache_enabled',
      cacheKey: null // Will be set by generateCacheKey()
    }
  }

  /**
   * Generate cache key from user input
   * Consistent cache key generation across all components
   * @param {string} userInput - Clean user input without command prefix
   * @param {Object} command - Command object for context
   * @returns {string} Cache key
   */
  generateCacheKey(userInput, command = null) {
    // Use clean user input as cache key (without command prefix)
    const cleanInput = userInput.trim()
    
    // For multi-model commands, include command ID in key for uniqueness
    if (command?.models && Array.isArray(command.models) && command.models.length > 1) {
      const cacheKey = `${command.id || 'multi'}: ${cleanInput}`
      this.logger.debug(`CacheManager: Generated multi-model cache key: ${cacheKey}`)
      return cacheKey
    }
    
    this.logger.debug(`CacheManager: Generated cache key: ${cleanInput}`)
    return cleanInput
  }

  /**
   * Check if cache has entry for given key
   * @param {string} cacheKey - Cache key to check
   * @returns {boolean} True if cache has entry
   */
  async hasCache(cacheKey) {
    if (!cacheKey) return false
    
    const hasEntry = cache.has(cacheKey)
    if (hasEntry) {
      this.stats.cacheHits++
      this.logger.debug(`CacheManager: Cache hit for key: ${cacheKey}`)
    } else {
      this.stats.cacheMisses++  
      this.logger.debug(`CacheManager: Cache miss for key: ${cacheKey}`)
    }
    
    return hasEntry
  }

  /**
   * Get cached response
   * @param {string} cacheKey - Cache key to retrieve
   * @returns {*} Cached value or undefined
   */
  async getCache(cacheKey) {
    if (!cacheKey) return undefined
    
    const value = cache.get(cacheKey)
    if (value) {
      this.logger.debug(`CacheManager: Retrieved cached response for key: ${cacheKey}`)
    }
    
    return value
  }

  /**
   * Store response in cache
   * @param {string} cacheKey - Cache key to store under
   * @param {*} response - Response to cache
   * @param {Object} cacheDecision - Decision from shouldCache()
   */
  async setCache(cacheKey, response, cacheDecision) {
    if (!cacheDecision.shouldStore || !cacheKey) {
      this.logger.debug(`CacheManager: Not storing cache - shouldStore: ${cacheDecision.shouldStore}, key: ${cacheKey}`)
      return
    }

    try {
      await cache.set(cacheKey, response)
      this.logger.debug(`CacheManager: Stored response in cache with key: ${cacheKey}`)
    } catch (error) {
      this.logger.error(`CacheManager: Failed to store cache: ${error.message}`)
    }
  }

  /**
   * Store multiple responses for multi-model commands
   * @param {string} cacheKey - Cache key
   * @param {Object} responses - Multiple provider responses  
   * @param {Object} cacheDecision - Decision from shouldCache()
   */
  async setMultipleResponses(cacheKey, responses, cacheDecision) {
    if (!cacheDecision.shouldStore || !cacheKey) {
      this.logger.debug(`CacheManager: Not storing multi-provider cache - shouldStore: ${cacheDecision.shouldStore}, key: ${cacheKey}`)
      return
    }

    try {
      await cache.setMultipleResponses(cacheKey, responses)
      this.logger.debug(`CacheManager: Stored multi-provider responses in cache with key: ${cacheKey}`)
    } catch (error) {
      this.logger.error(`CacheManager: Failed to store multi-provider cache: ${error.message}`)
    }
  }

  /**
   * Get multiple responses for multi-model commands
   * @param {string} cacheKey - Cache key
   * @returns {Object} Multiple provider responses or undefined
   */
  async getMultipleResponses(cacheKey) {
    if (!cacheKey) return undefined
    
    const responses = cache.getMultipleResponses(cacheKey)
    if (responses) {
      this.stats.cacheHits++
      this.logger.debug(`CacheManager: Retrieved multi-provider cached responses for key: ${cacheKey}`)
    }
    
    return responses
  }

  /**
   * Check if key has multiple responses
   * @param {string} cacheKey - Cache key to check
   * @returns {boolean} True if has multi-provider cache
   */
  async hasMultipleResponses(cacheKey) {
    if (!cacheKey) return false
    
    const hasEntry = cache.hasMultipleResponses(cacheKey)
    if (hasEntry) {
      this.stats.cacheHits++
      this.logger.debug(`CacheManager: Multi-provider cache hit for key: ${cacheKey}`)
    } else {
      this.stats.cacheMisses++
      this.logger.debug(`CacheManager: Multi-provider cache miss for key: ${cacheKey}`)
    }
    
    return hasEntry
  }

  /**
   * Clear cache for specific command
   * @param {string} commandKey - Command key to clear cache for
   * @returns {Promise<number>} Number of entries cleared
   */
  async clearCommandCache(commandKey) {
    const clearedCount = await cache.clearCommandCache(commandKey)
    this.logger.info(`CacheManager: Cleared ${clearedCount} cache entries for command: ${commandKey}`)
    return clearedCount
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: cache.size(),
      hitRate: this.stats.cacheHits + this.stats.cacheMisses > 0 
        ? ((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100).toFixed(2) + '%'
        : '0%'
    }
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      cacheSkips: 0,
      forceSkips: 0
    }
    this.logger.debug('CacheManager: Statistics reset')
  }
}

// Singleton instance
let cacheManagerInstance = null

/**
 * Get singleton CacheManager instance
 * @returns {CacheManager} Cache manager instance
 */
export function getCacheManager() {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager()
  }
  return cacheManagerInstance
}

// Default export for convenience
export default getCacheManager()