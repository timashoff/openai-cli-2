// Application constants
export const APP_CONSTANTS = {
  // Limits
  MAX_INPUT_LENGTH: 10000, // Maximum length of user input
  MAX_CONTEXT_HISTORY: 10, // Maximum number of messages in context
  MAX_CACHE_ENTRIES: 1000, // Maximum number of cache entries
  MAX_CACHE_ENTRY_SIZE: 1024 * 1024, // Maximum size of one cache entry (1MB)

  // Timeouts
  API_TIMEOUT: 100000, // 100 seconds for API requests
  CACHE_TTL: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds

  // Spinner and animation sizes
  SPINNER_INTERVAL: 100, // Spinner update interval in ms
  TYPING_DELAY: 10, // Delay between characters when typing response
  CLEAR_TIMEOUT: 100, // Timeout for screen clear

  // Paths
  CACHE_DIR_NAME: 'AI_responses',
  CACHE_FILE_NAME: 'cache.json',
  
  // Special markers
  CLIPBOARD_MARKER: '$$',
  FORCE_FLAGS: [' --force', ' -f'],

  // Regular expressions for validation
  REGEX: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    SAFE_STRING: /^[a-zA-Z0-9\s\-_.,!?]+$/,
    API_KEY_OPENAI: /^sk-[a-zA-Z0-9\-_]{20,}$/,
    API_KEY_DEEPSEEK: /^sk-[a-zA-Z0-9\-_]{20,}$/,
    API_KEY_ANTHROPIC: /^sk-ant-api03-[a-zA-Z0-9\-_]{95}$/,
  },
}

// Error constants
export const ERROR_CODES = {
  // User errors
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_API_KEY: 'INVALID_API_KEY',

  // System errors
  API_TIMEOUT: 'API_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CACHE_ERROR: 'CACHE_ERROR',
  FILE_SYSTEM_ERROR: 'FILE_SYSTEM_ERROR',

  // Security
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
}

// Logging constants
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
}

// HTTP statuses
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
}

// Supported operating systems
export const SUPPORTED_PLATFORMS = {
  DARWIN: 'darwin', // macOS
  LINUX: 'linux',
  WIN32: 'win32', // Windows
}

// Clipboard commands by platform
export const CLIPBOARD_COMMANDS = {
  [SUPPORTED_PLATFORMS.DARWIN]: 'pbpaste',
  [SUPPORTED_PLATFORMS.LINUX]: 'xclip -selection clipboard -o',
  [SUPPORTED_PLATFORMS.WIN32]: 'powershell.exe -command "Get-Clipboard"',
}




// Symbols for interface
export const UI_SYMBOLS = {
  SPINNER: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  CHECK: '✓',
  CROSS: '☓',
  ARROW: '▶',
  DOT: '•',
  ELLIPSIS: '...',
}

