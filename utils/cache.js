import fs from 'node:fs/promises'
import path from 'node:path'

const CACHE_DIR = path.join(process.cwd(), 'AI_responses')
const CACHE_FILE_PATH = path.join(CACHE_DIR, 'cache.json')

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
    cache = JSON.parse(data)
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

export default {
  async initialize() {
    await ensureCacheDir()
    await loadCache()
  },
  get(key) {
    return cache[key]
  },
  has(key) {
    return key in cache
  },
  async set(key, value) {
    cache[key] = value
    await saveCache()
  },
}
