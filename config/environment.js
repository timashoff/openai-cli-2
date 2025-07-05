import { AppError } from '../utils/error-handler.js'

// Валидация и конфигурация переменных окружения
const requiredEnvVars = {
  // API ключи могут быть необязательными при старте, но нужны при использовании
  OPENAI_API_KEY: { required: false, description: 'OpenAI API key' },
  DEEPSEEK_API_KEY: { required: false, description: 'DeepSeek API key' },
  ANTHROPIC_API_KEY: { required: false, description: 'Anthropic (Claude) API key' }
}

const optionalEnvVars = {
  NODE_ENV: { default: 'development', description: 'Environment mode' },
  LOG_LEVEL: { default: 'info', description: 'Logging level' },
  CACHE_TTL: { default: '2592000000', description: 'Cache TTL in milliseconds (default: 30 days)' },
  MAX_CACHE_SIZE: { default: '1000', description: 'Maximum cache entries' }
}

class EnvironmentConfig {
  constructor() {
    this.config = {}
    this.validateAndLoad()
  }

  validateAndLoad() {
    // Загружаем обязательные переменные
    for (const [key, config] of Object.entries(requiredEnvVars)) {
      const value = process.env[key]
      if (config.required && !value) {
        throw new AppError(
          `Required environment variable ${key} is not set. ${config.description}`,
          true,
          500
        )
      }
      this.config[key] = value
    }

    // Загружаем опциональные переменные с дефолтными значениями
    for (const [key, config] of Object.entries(optionalEnvVars)) {
      this.config[key] = process.env[key] || config.default
    }

    // Валидация числовых значений
    this.config.CACHE_TTL = this.parseNumber('CACHE_TTL', this.config.CACHE_TTL)
    this.config.MAX_CACHE_SIZE = this.parseNumber('MAX_CACHE_SIZE', this.config.MAX_CACHE_SIZE)

    // Валидация LOG_LEVEL
    const validLogLevels = ['error', 'warn', 'info', 'debug']
    if (!validLogLevels.includes(this.config.LOG_LEVEL)) {
      console.warn(`Invalid LOG_LEVEL: ${this.config.LOG_LEVEL}. Using 'info'`)
      this.config.LOG_LEVEL = 'info'
    }
  }

  parseNumber(key, value) {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 0) {
      console.warn(`Invalid ${key}: ${value}. Using default.`)
      return parseInt(optionalEnvVars[key].default, 10)
    }
    return num
  }

  get(key) {
    return this.config[key]
  }

  has(key) {
    return key in this.config && this.config[key] !== undefined
  }

  isDevelopment() {
    return this.config.NODE_ENV === 'development'
  }

  isProduction() {
    return this.config.NODE_ENV === 'production'
  }

  // Проверка наличия API ключа для конкретного провайдера
  hasApiKey(providerKey) {
    const envKey = this.getApiKeyEnvName(providerKey)
    return this.has(envKey) && this.get(envKey)
  }

  getApiKeyEnvName(providerKey) {
    const mapping = {
      openai: 'OPENAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY'
    }
    return mapping[providerKey]
  }

  validateApiKey(providerKey) {
    const envKey = this.getApiKeyEnvName(providerKey)
    if (!this.hasApiKey(providerKey)) {
      throw new AppError(
        `API key for ${providerKey} is not configured. Please set ${envKey} environment variable.`,
        true,
        400
      )
    }
  }
}

export const envConfig = new EnvironmentConfig()
export default envConfig
