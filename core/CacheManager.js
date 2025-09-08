/**
 * CacheManager - Centralized cache logic following Single Source of Truth principle
 * Consolidates all caching decisions from 5 different files into one place
 * Uses simple boolean isCached field from DatabaseCommandService
 */
import cache from '../utils/cache.js'
import { logger } from '../utils/logger.js'
import { APP_CONSTANTS } from '../config/constants.js'

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
   * Determine if request should be cached
   * Simple boolean check - RequestRouter already handled force flags
   */
  shouldCache(command) {
    if (!APP_CONSTANTS.CACHE_ENABLED) {
      this.stats.cacheSkips++
      return false
    }
    return command && command.isCached
  }

  /**
   * Generate cache key from user input
   * Consistent cache key generation across all components
   */
  generateCacheKey(userInput, command = null) {
    // Use clean user input as cache key (without command prefix)
    const cleanInput = userInput.trim()
    
    // For multi-model commands, include command ID in key for uniqueness
    if (command && command.models && Array.isArray(command.models) && command.models.length > 1) {
      const cacheKey = `${command.id || 'multi'}: ${cleanInput}`
      this.logger.debug(`CacheManager: Generated multi-model cache key: ${cacheKey}`)
      return cacheKey
    }
    
    this.logger.debug(`CacheManager: Generated cache key: ${cleanInput}`)
    return cleanInput
  }

  /**
   * Generate per-model cache key
   * Format: commandId:userInput:model
   */
  generateModelCacheKey(userInput, commandId, model) {
    const cleanInput = userInput.trim()
    const modelKey = `${commandId}:${cleanInput}:${model}`
    this.logger.debug(`CacheManager: Generated per-model cache key: ${modelKey}`)
    return modelKey
  }

  /**
   * Check if cache has entry for given key


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


   */
  async getCache(cacheKey) {
    if (!APP_CONSTANTS.CACHE_ENABLED || !cacheKey) return undefined
    
    const value = cache.get(cacheKey)
    if (value) {
      this.logger.debug(`CacheManager: Retrieved cached response for key: ${cacheKey}`)
    }
    
    return value
  }

  /**
   * Store response in cache


   */
  async setCache(cacheKey, response) {
    if (!APP_CONSTANTS.CACHE_ENABLED || !cacheKey) return

    try {
      await cache.set(cacheKey, response)
    } catch (error) {
      this.logger.error(`CacheManager: Failed to store cache: ${error.message}`)
    }
  }

  /**
   * Store multiple responses for multi-model commands


   */
  async setMultipleResponses(cacheKey, responses) {
    if (!cacheKey) return

    try {
      await cache.setMultipleResponses(cacheKey, responses)
    } catch (error) {
      this.logger.error(`CacheManager: Failed to store multi-provider cache: ${error.message}`)
    }
  }

  /**
   * Get multiple responses for multi-model commands


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


   */
  async clearCommandCache(commandKey) {
    const clearedCount = await cache.clearCommandCache(commandKey)
    this.logger.info(`CacheManager: Cleared ${clearedCount} cache entries for command: ${commandKey}`)
    return clearedCount
  }

  /**
   * Get cache statistics

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

  /**
   * Check if cache has entry for specific model




   */
  async hasCacheByModel(userInput, commandId, model) {
    const cacheKey = this.generateModelCacheKey(userInput, commandId, model)
    return await this.hasCache(cacheKey)
  }

  /**
   * Get cached response for specific model




   */
  async getCacheByModel(userInput, commandId, model) {
    if (!APP_CONSTANTS.CACHE_ENABLED) return undefined
    const cacheKey = this.generateModelCacheKey(userInput, commandId, model)
    return await this.getCache(cacheKey)
  }

  /**
   * Store response in cache for specific model




   */
  async setCacheByModel(userInput, commandId, model, response) {
    if (!APP_CONSTANTS.CACHE_ENABLED) return
    const cacheKey = this.generateModelCacheKey(userInput, commandId, model)
    await this.setCache(cacheKey, response)
  }
}

// Singleton instance
let cacheManagerInstance = null

/**
 * Get singleton CacheManager instance

 */
export function getCacheManager() {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager()
  }
  return cacheManagerInstance
}

// Default export for convenience
export default getCacheManager()