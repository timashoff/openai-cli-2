/**
 * Caching Plugin for Enhanced Provider Factory
 * Adds intelligent response caching with TTL and LRU eviction
 */
export class CachingPlugin {
  constructor(options = {}) {
    this.options = {
      maxSize: options.maxSize || 1000,
      defaultTTL: options.defaultTTL || 3600000, // 1 hour
      cleanupInterval: options.cleanupInterval || 300000, // 5 minutes
      cacheKeyGenerator: options.cacheKeyGenerator || this.defaultKeyGenerator
    }
    
    this.cache = new Map()
    this.accessOrder = new Map() // For LRU tracking
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      cleanups: 0
    }
    
    this.startCleanupInterval()
  }

  initialize(factory) {
    this.factory = factory
    
    // Add middleware to enhance instances with caching
    factory.addMiddleware('after-create', (context) => {
      this.enhanceInstanceWithCaching(context.instance)
    })
  }

  enhanceInstanceWithCaching(instance) {
    const originalMethod = instance.createChatCompletion.bind(instance)
    
    instance.createChatCompletion = async (model, messages, options = {}) => {
      // Skip caching for streaming requests
      if (options.stream) {
        return await originalMethod(model, messages, options)
      }
      
      // Generate cache key
      const cacheKey = this.options.cacheKeyGenerator(model, messages, options)
      
      // Check cache
      const cached = this.get(cacheKey)
      if (cached) {
        this.stats.hits++
        console.log(`Cache hit for key: ${cacheKey.substring(0, 20)}...`)
        return cached.response
      }
      
      // Cache miss - get response from provider
      this.stats.misses++
      console.log(`Cache miss for key: ${cacheKey.substring(0, 20)}...`)
      
      const response = await originalMethod(model, messages, options)
      
      // Cache the response
      const ttl = options.cacheTTL || this.options.defaultTTL
      this.set(cacheKey, {
        response,
        model,
        timestamp: Date.now(),
        ttl
      })
      
      return response
    }
    
    // Add cache management methods to instance
    instance.clearCache = () => this.clear()
    instance.getCacheStats = () => ({ ...this.stats, size: this.cache.size })
  }

  defaultKeyGenerator(model, messages, options) {
    // Create deterministic hash from model, messages, and relevant options
    const keyData = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature,
      max_tokens: options.max_tokens,
      top_p: options.top_p
    }
    
    return this.hashObject(keyData)
  }

  hashObject(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort())
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return hash.toString(36)
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    
    // Check TTL
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      this.accessOrder.delete(key)
      return null
    }
    
    // Update LRU order
    this.accessOrder.delete(key)
    this.accessOrder.set(key, Date.now())
    
    return item
  }

  set(key, value) {
    // Check if we need to evict
    if (this.cache.size >= this.options.maxSize) {
      this.evictLRU()
    }
    
    this.cache.set(key, value)
    this.accessOrder.set(key, Date.now())
  }

  evictLRU() {
    // Find least recently used item
    let oldestKey = null
    let oldestTime = Date.now()
    
    for (const [key, time] of this.accessOrder) {
      if (time < oldestTime) {
        oldestTime = time
        oldestKey = key
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.accessOrder.delete(oldestKey)
      this.stats.evictions++
    }
  }

  startCleanupInterval() {
    setInterval(() => {
      this.cleanup()
    }, this.options.cleanupInterval)
  }

  cleanup() {
    const now = Date.now()
    let cleaned = 0
    
    for (const [key, item] of this.cache) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key)
        this.accessOrder.delete(key)
        cleaned++
      }
    }
    
    if (cleaned > 0) {
      this.stats.cleanups++
      console.log(`Cleaned up ${cleaned} expired cache entries`)
    }
  }

  clear() {
    this.cache.clear()
    this.accessOrder.clear()
    console.log('Cache cleared')
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100 
      : 0
    
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: hitRate.toFixed(2) + '%',
      maxSize: this.options.maxSize
    }
  }
}