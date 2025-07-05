import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { AppError } from './error-handler.js'

const CACHE_DIR = path.join(os.homedir(), 'AI_responses')
const CACHE_FILE_PATH = path.join(CACHE_DIR, 'cache.json')
const MAX_CACHE_SIZE = 1000 // Максимальное количество записей в кеше
const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000 // 30 дней в миллисекундах

let cache = {}

const ensureCacheDir = async () => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  } catch (error) {
    console.error('Error creating cache directory:', error)
  }
}

const loadCache = async () => {
  try {
    const data = await fs.readFile(CACHE_FILE_PATH, 'utf-8')
    const loadedCache = JSON.parse(data)
    
    // Валидация структуры кеша
    if (typeof loadedCache === 'object' && loadedCache !== null) {
      cache = loadedCache
    } else {
      cache = {}
    }
    
    // Очистка старых записей при загрузке
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
  } catch (error) {
    console.error('Error saving cache file:', error)
  }
}

// Очистка устаревших записей
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

// Ограничение размера кеша
const enforceCacheLimit = async () => {
  const keys = Object.keys(cache)
  if (keys.length > MAX_CACHE_SIZE) {
    // Удаляем самые старые записи
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

// Валидация входных данных
const validateCacheInput = (key, value) => {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new AppError('Cache key must be a non-empty string', true, 400)
  }
  
  if (value === undefined || value === null) {
    throw new AppError('Cache value cannot be null or undefined', true, 400)
  }
  
  // Проверка размера значения (например, не больше 1MB)
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
      // Проверяем, не истекла ли запись
      if (entry.timestamp && Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache() // Асинхронно сохраняем без ожидания
        return undefined
      }
      return entry.value
    }
    
    // Поддержка старого формата кеша
    return entry
  },
  
  has(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      return false
    }
    
    const entry = cache[key]
    if (typeof entry === 'object' && entry.timestamp) {
      // Проверяем, не истекла ли запись
      if (Date.now() - entry.timestamp > MAX_CACHE_AGE) {
        delete cache[key]
        this.saveCache() // Асинхронно сохраняем без ожидания
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
  }
}
