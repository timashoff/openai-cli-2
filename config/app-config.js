/**
 * Centralized application configuration
 * Contains all application constants, timeouts, and configurable values
 */

export const APP_CONFIG = {
  // Network and API Configuration
  TIMEOUTS: {
    PROVIDER_INIT: 30000,       // 30 seconds for provider initialization
    CLIPBOARD_ACCESS: 5000,     // 5 seconds for clipboard operations
    HEALTH_CHECK: 10000,        // 10 seconds for health checks
    SHUTDOWN: 5000,             // 5 seconds for graceful shutdown
    CONNECTION: 120000,         // 2 minutes for connection timeout
    STREAM_PROCESSING: 300000,  // 5 minutes for stream processing
  },

  // Rate Limiting
  RATE_LIMITS: {
    DEFAULT_REQUESTS: 10,       // Default requests per window
    DEFAULT_WINDOW: 60000,      // Default window size (1 minute)
    OPENAI_REQUESTS: 20,        // OpenAI requests per minute
    DEEPSEEK_REQUESTS: 15,      // DeepSeek requests per minute
    ANTHROPIC_REQUESTS: 10,     // Anthropic requests per minute
    BURST_MULTIPLIER: 2,        // Burst multiplier for rate limits
  },

  // Content and Size Limits
  LIMITS: {
    MAX_OUTPUT_LENGTH: 50000,   // Maximum AI response length
    MAX_CONTEXT_HISTORY: 20,    // Maximum context history items
    MAX_CACHE_ENTRIES: 1000,    // Maximum cache entries
    MAX_LOG_ENTRIES: 10000,     // Maximum log entries in memory
    MAX_RETRY_ATTEMPTS: 3,      // Maximum retry attempts
    MAX_CONCURRENT_REQUESTS: 5, // Maximum concurrent API requests
    MAX_FILE_SIZE: 10485760,    // Maximum file size (10MB)
    WEB_CONTENT_LENGTH: 25000,  // Maximum web content length to extract
  },

  // Cache Configuration
  CACHE: {
    DEFAULT_TTL: 3600000,       // 1 hour default TTL
    TRANSLATION_TTL: 7200000,   // 2 hours for translations
    MODEL_LIST_TTL: 1800000,    // 30 minutes for model lists
    HEALTH_CHECK_TTL: 300000,   // 5 minutes for health checks
    MAX_MEMORY_USAGE: 104857600, // 100MB max cache memory
    CLEANUP_INTERVAL: 600000,   // 10 minutes cleanup interval
  },

  // Retry and Backoff Configuration
  RETRY: {
    INITIAL_DELAY: 1000,        // Initial retry delay (1 second)
    MAX_DELAY: 30000,           // Maximum retry delay (30 seconds)
    BACKOFF_MULTIPLIER: 2,      // Exponential backoff multiplier
    JITTER_FACTOR: 0.1,         // Random jitter factor
    RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504],
    RETRYABLE_ERROR_TYPES: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'],
  },

  // Logging Configuration
  LOGGING: {
    DEFAULT_LEVEL: 'info',      // Default log level
    MAX_FILE_SIZE: 10485760,    // 10MB max log file size
    MAX_FILES: 5,               // Maximum log file rotation
    CONSOLE_FORMAT: 'simple',   // Console log format
    FILE_FORMAT: 'json',        // File log format
    BUFFER_SIZE: 100,           // Log buffer size
  },

  // Performance and Monitoring
  PERFORMANCE: {
    HEALTH_CHECK_INTERVAL: 300000,  // 5 minutes between health checks
    STATS_COLLECTION_INTERVAL: 60000, // 1 minute stats collection
    MEMORY_USAGE_THRESHOLD: 0.8,     // 80% memory usage threshold
    CPU_USAGE_THRESHOLD: 0.9,        // 90% CPU usage threshold
    RESPONSE_TIME_THRESHOLD: 30000,   // 30 second response time threshold
    ERROR_RATE_THRESHOLD: 0.1,       // 10% error rate threshold
  },

  // UI and Display Configuration
  UI: {
    CLEAR_TIMEOUT: 100,         // Terminal clear timeout
    SPINNER_INTERVAL: 100,      // Spinner update interval
    PROGRESS_UPDATE_INTERVAL: 500, // Progress update interval
    MIN_DISPLAY_TIME: 1000,     // Minimum display time for messages
    ANIMATION_DURATION: 300,    // UI animation duration

    // Help Command Table Layout
    HELP_TABLE: {
      COLUMN_WIDTHS: {
        KEYS: 14,
        DESCRIPTION: 36,
        CACHE: 5,
        MODELS: 6
      },
      SEPARATORS: {
        COLUMN: '│',
        ROW: '─'
      },
      FORMATTING: {
        ROW_INDENT: 0,        // отступ строк данных
        SEPARATOR_SPACES: 0,  // пробелов после каждого разделителя
        SEPARATOR_COUNT: 0,    // количество разделителей между колонками
      }
    }
  },

  // Security Configuration
  SECURITY: {
    MAX_HEADER_SIZE: 8192,      // Maximum HTTP header size
    MAX_URL_LENGTH: 2048,       // Maximum URL length
    INPUT_VALIDATION_TIMEOUT: 1000, // Input validation timeout
    SANITIZATION_MAX_LENGTH: 1000000, // Maximum sanitization length
  },

  // Feature Flags
  FEATURES: {
    ENABLE_CACHING: true,           // Enable response caching
    ENABLE_RETRY_LOGIC: true,       // Enable automatic retries
    ENABLE_RATE_LIMITING: true,     // Enable rate limiting
    ENABLE_HEALTH_CHECKS: true,     // Enable health monitoring
    ENABLE_METRICS: true,           // Enable metrics collection
    ENABLE_DEBUG_MODE: false,       // Enable debug mode
    ENABLE_EXPERIMENTAL_FEATURES: false, // Enable experimental features
  },

  // Provider-Specific Configuration
  PROVIDERS: {
    deepseek: {
      name: 'DeepSeek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultModel: 'deepseek-chat',
      maxTokens: 4096,
      temperature: 0.7,
      streaming: true,
    },
    openai: {
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      defaultModel: 'gpt-5-mini',
      maxTokens: 4096,
      temperature: 0.7,
      streaming: true,
    },
    anthropic: {
      name: 'Anthropic',
      baseURL: 'https://api.anthropic.com/v1',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      isClaude: true,
      defaultModel: 'claude-3-5-sonnet-20241022',
      maxTokens: 4096,
      temperature: 0.7,
      streaming: true,
    },
  },

  // Environment-Specific Overrides
  ENVIRONMENTS: {
    development: {
      LOGGING: { DEFAULT_LEVEL: 'debug' },
      FEATURES: { ENABLE_DEBUG_MODE: true },
      PERFORMANCE: { HEALTH_CHECK_INTERVAL: 60000 }, // More frequent in dev
    },
    production: {
      LOGGING: { DEFAULT_LEVEL: 'warn' },
      FEATURES: { ENABLE_DEBUG_MODE: false },
      SECURITY: { INPUT_VALIDATION_TIMEOUT: 500 }, // Stricter in prod
    },
    test: {
      LOGGING: { DEFAULT_LEVEL: 'error' },
      TIMEOUTS: { API_REQUEST: 5000 }, // Faster timeouts in tests
      CACHE: { DEFAULT_TTL: 1000 }, // Short TTL in tests
    },
  }
}

/**
 * Get configuration value with environment override



 */
export function getConfig(path, environment = process.env.NODE_ENV || 'development') {
  const pathParts = path.split('.')

  // Get base value
  let value = APP_CONFIG
  for (const part of pathParts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part]
    } else {
      throw new Error(`Configuration path '${path}' not found`)
    }
  }

  // Apply environment override if exists
  if (APP_CONFIG.ENVIRONMENTS[environment]) {
    let envOverride = APP_CONFIG.ENVIRONMENTS[environment]
    for (const part of pathParts) {
      if (envOverride && typeof envOverride === 'object' && part in envOverride) {
        envOverride = envOverride[part]
      } else {
        envOverride = null
        break
      }
    }

    if (envOverride !== null && envOverride !== undefined) {
      return envOverride
    }
  }

  return value
}

/**
 * Validate configuration values


 */
export function validateConfig(config = APP_CONFIG) {
  const errors = []

  try {
    // Validate timeouts are positive numbers
    for (const [key, value] of Object.entries(config.TIMEOUTS)) {
      if (typeof value !== 'number' || value <= 0) {
        errors.push(`TIMEOUTS.${key} must be a positive number, got: ${value}`)
      }
    }

    // Validate limits are positive numbers
    for (const [key, value] of Object.entries(config.LIMITS)) {
      if (typeof value !== 'number' || value <= 0) {
        errors.push(`LIMITS.${key} must be a positive number, got: ${value}`)
      }
    }

    // Validate retry configuration
    if (config.RETRY.BACKOFF_MULTIPLIER <= 1) {
      errors.push('RETRY.BACKOFF_MULTIPLIER must be greater than 1')
    }

    if (config.RETRY.JITTER_FACTOR < 0 || config.RETRY.JITTER_FACTOR > 1) {
      errors.push('RETRY.JITTER_FACTOR must be between 0 and 1')
    }

    // Validate performance thresholds
    if (config.PERFORMANCE.MEMORY_USAGE_THRESHOLD <= 0 || config.PERFORMANCE.MEMORY_USAGE_THRESHOLD > 1) {
      errors.push('PERFORMANCE.MEMORY_USAGE_THRESHOLD must be between 0 and 1')
    }

  } catch (error) {
    errors.push(`Configuration validation error: ${error.message}`)
  }

  return errors
}

/**
 * Get all configuration as a flattened object


 */
export function getFlatConfig(environment = process.env.NODE_ENV || 'development') {
  const flattened = {}

  function flatten(obj, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        flatten(value, newKey)
      } else {
        flattened[newKey] = value
      }
    }
  }

  // Apply environment overrides
  const config = { ...APP_CONFIG }
  if (config.ENVIRONMENTS[environment]) {
    // Merge environment overrides (deep merge would be better)
    Object.assign(config, config.ENVIRONMENTS[environment])
  }

  flatten(config)
  return flattened
}
