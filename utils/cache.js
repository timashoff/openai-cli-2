import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { AppError } from './error-handler.js'

const CACHE_DIR = path.join(os.homedir(), 'AI_responses')
const CACHE_FILE_PATH = path.join(CACHE_DIR, 'cache.json')
const MAX_CACHE_SIZE = 1000 // Maximum number of cache entries
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days in milliseconds

let cache = {}

const ensureCacheDir = async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    
    // Set secure permissions for cache directory (owner read/write/execute only)
    try {
      await fs.chmod(CACHE_DIR, 0o700)
    } catch (chmodError) {
      console.warn('Warning: Could not set secure permissions on cache directory')
    }
  } catch (error) {
    console.error('Error creating cache directory:', error)
  }
}

const loadCache = async () => {
  try {
    const data = await fs.readFile(CACHE_FILE_PATH, 'utf-8')
    const loadedCache = JSON.parse(data)
    
    // Cache structure validation
    if (typeof loadedCache === 'object' && loadedCache !== null) {
      cache = loadedCache
    } else {
      cache = {}
    }
    
    // Clean old entries on load
    await cleanupExpiredEntries()
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, which is fine on first run
      cache = {}
    } else {
      console.error('Error loading cache file:', error)
      cache = {}
    }
  }
}

const saveCache = async () => {
  try {
    await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cache, null, 2))
    
    // Set secure permissions for cache file (owner read/write only)
    try {
      await fs.chmod(CACHE_FILE_PATH, 0o600)
    } catch (chmodError) {
      console.warn('Warning: Could not set secure permissions on cache file')
    }
  } catch (error) {
    console.error('Error saving cache file:', error)
  }
}

// Cleanup expired entries
const cleanupExpiredEntries = async () => {
  const now = Date.now()
  const keysToDelete = []
  
  for (const [key, entry] of Object.entries(cache)) {
    if (typeof entry === 'object' && entry.timestamp) {
      if (now - entry.timestamp > MAX_CACHE_AGE) {
        keysToDelete.push(key)
      }
    }
  }
  
  keysToDelete.forEach(key => delete cache[key])
  
  if (keysToDelete.length > 0) {
    console.log(`Cleaned up ${keysToDelete.length} expired cache entries`)
    await saveCache()
  }
}

// Cache size limitation
const enforceCacheLimit = async () => {
  const keys = Object.keys(cache)
  if (keys.length > MAX_CACHE_SIZE) {
    // Remove oldest entries
    const entries = Object.entries(cache)
      .filter(([_, entry]) => typeof entry === 'object' && entry.timestamp)
      .sort(([_a, a], [_b, b]) => a.timestamp - b.timestamp)
    
    const keysToDelete = entries.slice(0, keys.length - MAX_CACHE_SIZE).map(([key]) => key)
    keysToDelete.forEach(key => delete cache[key])
    
    if (keysToDelete.length > 0) {
      console.log(`Cache size limit reached. Removed ${keysToDelete.length} oldest entries`)
      await saveCache()
    }
  }
}

// Input data validation
const validateCacheInput = (key, value) => {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new AppError('Cache key must be a non-empty string', true, 400)
  }
  
  if (value === undefined || value === null) {
    throw new AppError('Cache value cannot be null or undefined', true, 400)
  }
  
  // Check value size (e.g., no more than 1MB)
  const valueSize = JSON.stringify(value).length
  if (valueSize > 1024 * 1024) {
    throw new AppError('Cache value is too large (max 1MB)', true, 400)
  }
}

export default {
  async initialize() {
    await ensureCacheDir()
    await loadCache()
  },
  
  get(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return undefined
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.value !== undefined) {
      // Check if entry has expired
      if (entry.timestamp && Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache().catch(console.error) // Save asynchronously with error handling
        return undefined
      }
      return entry.value
    }
    
    // Support for old cache format
    return entry
  },
  
  has(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return false
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.timestamp) {
      // Check if entry has expired
      if (Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache().catch(console.error) // Save asynchronously with error handling
        return false
      }
    }
    
    return key in cache
  },
  
  async set(key, value) {
    try {
      validateCacheInput(key, value)
      
      cache[key] = {
        value: value,
        timestamp: Date.now()
      }
      
      await enforceCacheLimit()
      await saveCache()
    } catch (error) {
      console.error('Error setting cache value:', error.message)
      throw error
    }
  },
  
  async clear() {
    cache = {}
    await saveCache()
  },
  
  async cleanupExpired() {
    await cleanupExpiredEntries()
  },
  
  size() {
    return Object.keys(cache).length
  },
  
  async saveCache() {
    await saveCache()
  },

  // Multi-provider cache methods
  
  /**
   * Set multiple responses from different providers
   */
  async setMultipleResponses(key, responses) {
    try {
      validateCacheInput(key, responses)
      
      // Store in multi-provider format
      const multiProviderEntry = {
        type: 'multi_provider',
        providers: responses,
        timestamp: Date.now()
      }
      
      cache[key] = multiProviderEntry
      
      await enforceCacheLimit()
      await saveCache()
    } catch (error) {
      console.error('Error setting multi-provider cache:', error.message)
      throw error
    }
  },

  /**
   * Get multiple responses from different providers
   */
  getMultipleResponses(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return undefined
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.type === 'multi_provider') {
      // Check if entry has expired
      if (entry.timestamp && Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache().catch(console.error)
        return undefined
      }
      return entry.providers
    }
    
    return undefined
  },

  /**
   * Check if key has multi-provider responses
   */
  hasMultipleResponses(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return false
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.type === 'multi_provider') {
      // Check if entry has expired
      if (entry.timestamp && Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache().catch(console.error)
        return false
      }
      return true
    }
    
    return false
  },

  /**
   * Set document file reference
   */
  async setDocumentFile(key, fileInfo, translationContent) {
    try {
      validateCacheInput(key, { fileInfo, translationContent })
      
      const docEntry = {
        type: 'document',
        file: fileInfo,
        content: translationContent,
        timestamp: Date.now()
      }
      
      cache[key] = docEntry
      
      await enforceCacheLimit()
      await saveCache()
    } catch (error) {
      console.error('Error setting document file cache:', error.message)
      throw error
    }
  },

  /**
   * Get document file info
   */
  getDocumentFile(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return undefined
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.type === 'document') {
      // Check if entry has expired
      if (entry.timestamp && Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache().catch(console.error)
        return undefined
      }
      return {
        file: entry.file,
        content: entry.content
      }
    }
    
    return undefined
  },
  
  /**
   * Clear all cache entries for a specific command

   */
  async clearCommandCache(commandKey) {
    const keysToDelete = []
    const commandLower = commandKey.toLowerCase()
    
    // Find all cache keys that start with the command
    for (const key in cache) {
      const keyLower = key.toLowerCase()
      if (keyLower.startsWith(commandLower + ' ') || keyLower === commandLower) {
        keysToDelete.push(key)
      }
    }
    
    // Delete found keys
    for (const key of keysToDelete) {
      delete cache[key]
    }
    
    if (keysToDelete.length > 0) {
      await saveCache()
    }
    
    return keysToDelete.length
  }
}
