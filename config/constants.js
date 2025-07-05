// Константы приложения
export const APP_CONSTANTS = {
  // Лимиты
  MAX_INPUT_LENGTH: 10000, // Максимальная длина пользовательского ввода
  MAX_CONTEXT_HISTORY: 10, // Максимальное количество сообщений в контексте
  MAX_CACHE_ENTRIES: 1000, // Максимальное количество записей в кеше
  MAX_CACHE_ENTRY_SIZE: 1024 * 1024, // Максимальный размер одной записи кеша (1MB)
  
  // Таймауты
  API_TIMEOUT: 100000, // 100 секунд для API запросов
  CACHE_TTL: 30 * 24 * 60 * 60 * 1000, // 30 дней в миллисекундах
  
  // Размеры спиннера и анимации
  SPINNER_INTERVAL: 100, // Интервал обновления спиннера в мс
  TYPING_DELAY: 10, // Задержка между символами при печати ответа
  
  // Пути
  CACHE_DIR_NAME: 'AI_responses',
  CACHE_FILE_NAME: 'cache.json',
  
  // Регулярные выражения для валидации
  REGEX: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    SAFE_STRING: /^[a-zA-Z0-9\s\-_.,!?]+$/,
    API_KEY_OPENAI: /^sk-[a-zA-Z0-9]{20,}$/,
    API_KEY_DEEPSEEK: /^sk-[a-zA-Z0-9]{20,}$/,
    API_KEY_ANTHROPIC: /^sk-ant-api03-[a-zA-Z0-9\-_]{95}$/
  }
}

// Константы ошибок
export const ERROR_CODES = {
  // Пользовательские ошибки
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  INVALID_API_KEY: 'INVALID_API_KEY',
  
  // Системные ошибки
  API_TIMEOUT: 'API_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CACHE_ERROR: 'CACHE_ERROR',
  FILE_SYSTEM_ERROR: 'FILE_SYSTEM_ERROR',
  
  // Безопасность
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN'
}

// Константы логирования
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug'
}

// Статусы HTTP
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
  SERVICE_UNAVAILABLE: 503
}

// Поддерживаемые операционные системы
export const SUPPORTED_PLATFORMS = {
  DARWIN: 'darwin',   // macOS
  LINUX: 'linux',
  WIN32: 'win32'      // Windows
}

// Команды для работы с буфером обмена по платформам
export const CLIPBOARD_COMMANDS = {
  [SUPPORTED_PLATFORMS.DARWIN]: 'pbpaste',
  [SUPPORTED_PLATFORMS.LINUX]: 'xclip -selection clipboard -o',
  [SUPPORTED_PLATFORMS.WIN32]: 'powershell.exe -command "Get-Clipboard"'
}

// Поддерживаемые модели по умолчанию
export const DEFAULT_MODEL_PRIORITIES = [
  'o1-mini',
  'gpt-4o-mini', 
  'gpt-4o',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'deepseek-chat'
]

// Ключи для команд перевода
export const TRANSLATION_COMMAND_KEYS = [
  'RUSSIAN',
  'ENGLISH', 
  'CHINESE',
  'PINYIN',
  'TRANSCRIPTION',
  'HSK',
  'HSK_SS'
]

// Цвета для вывода (дублируем для удобства)
export const COLORS = {
  RESET: '\x1b[0m',
  CYAN: '\x1b[36m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BOLD: '\x1b[1m',
  GREY: '\x1b[90m'
}

// Символы для интерфейса
export const UI_SYMBOLS = {
  SPINNER: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  CHECK: '✓',
  CROSS: '☓',
  ARROW: '▶',
  DOT: '•',
  ELLIPSIS: '...'
}

// Environments
export const ENVIRONMENTS = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
  TEST: 'test'
}
