import { APP_CONSTANTS } from './constants.js'
import { createBaseError } from '../core/error-system/index.js'
import { validateString, validateNumber, validateChoice } from '../utils/validation.js'

/**
 * Configuration Manager - Centralized configuration handling
 */
export class ConfigManager {
  constructor() {
    this.config = new Map()
    this.validators = new Map()
    this.defaults = new Map()
    this.setupDefaults()
  }

  /**
   * Setup default configuration values
   */
  setupDefaults() {
    this.setDefault('maxInputLength', APP_CONSTANTS.MAX_INPUT_LENGTH)
    this.setDefault('maxContextHistory', APP_CONSTANTS.MAX_CONTEXT_HISTORY)
    this.setDefault('apiTimeout', APP_CONSTANTS.API_TIMEOUT)
    this.setDefault('cacheTtl', APP_CONSTANTS.CACHE_TTL)
    this.setDefault('typingDelay', APP_CONSTANTS.TYPING_DELAY)
    this.setDefault('spinnerInterval', APP_CONSTANTS.SPINNER_INTERVAL)
    
    // Setup validators
    this.addValidator('maxInputLength', (value) => validateNumber(value, 'maxInputLength', { min: 100, max: 100000 }))
    this.addValidator('maxContextHistory', (value) => validateNumber(value, 'maxContextHistory', { min: 0, max: 50 }))
    this.addValidator('apiTimeout', (value) => validateNumber(value, 'apiTimeout', { min: 5000, max: 300000 }))
    this.addValidator('cacheTtl', (value) => validateNumber(value, 'cacheTtl', { min: 3600000, max: 2592000000 }))
    this.addValidator('typingDelay', (value) => validateNumber(value, 'typingDelay', { min: 0, max: 100 }))
    this.addValidator('spinnerInterval', (value) => validateNumber(value, 'spinnerInterval', { min: 50, max: 1000 }))
  }

  /**
   * Set default value for a configuration key
   */
  setDefault(key, value) {
    this.defaults.set(key, value)
    if (!this.config.has(key)) {
      this.config.set(key, value)
    }
  }

  /**
   * Add validator for a configuration key
   */
  addValidator(key, validator) {
    this.validators.set(key, validator)
  }

  /**
   * Get configuration value
   */
  get(key) {
    return this.config.get(key) ?? this.defaults.get(key)
  }

  /**
   * Set configuration value with validation
   */
  set(key, value) {
    const validator = this.validators.get(key)
    if (validator) {
      try {
        value = validator(value)
      } catch (error) {
        throw createBaseError(`Configuration validation failed for ${key}: ${error.message}`, true, 400)
      }
    }
    
    this.config.set(key, value)
  }

  /**
   * Get all configuration as object
   */
  getAll() {
    const result = {}
    for (const [key, value] of this.defaults) {
      result[key] = this.get(key)
    }
    return result
  }

  /**
   * Load configuration from environment variables
   */
  loadFromEnv() {
    const envMappings = {
      'AI_CLI_MAX_INPUT_LENGTH': 'maxInputLength',
      'AI_CLI_MAX_CONTEXT_HISTORY': 'maxContextHistory',
      'AI_CLI_API_TIMEOUT': 'apiTimeout',
      'AI_CLI_CACHE_TTL': 'cacheTtl',
      'AI_CLI_TYPING_DELAY': 'typingDelay',
      'AI_CLI_SPINNER_INTERVAL': 'spinnerInterval'
    }

    for (const [envKey, configKey] of Object.entries(envMappings)) {
      const envValue = process.env[envKey]
      if (envValue !== undefined) {
        try {
          const numValue = parseInt(envValue, 10)
          if (!isNaN(numValue)) {
            this.set(configKey, numValue)
          }
        } catch (error) {
          console.warn(`Invalid environment variable value for ${envKey}: ${envValue}`)
        }
      }
    }
  }

  /**
   * Reset to defaults
   */
  reset() {
    this.config.clear()
    for (const [key, value] of this.defaults) {
      this.config.set(key, value)
    }
  }

  /**
   * Validate entire configuration
   */
  validate() {
    const errors = []
    
    for (const [key, validator] of this.validators) {
      const value = this.get(key)
      try {
        validator(value)
      } catch (error) {
        errors.push(`${key}: ${error.message}`)
      }
    }
    
    if (errors.length > 0) {
      throw createBaseError(`Configuration validation failed: ${errors.join(', ')}`, true, 400)
    }
    
    return true
  }
}

// Export singleton instance
export const configManager = new ConfigManager()