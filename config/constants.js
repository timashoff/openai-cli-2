export const APP_CONSTANTS = {
  MAX_INPUT_LENGTH: 30000, // Maximum length of user input
  MAX_CONTEXT_HISTORY: 16, // Maximum number of messages in context
  MAX_LINKS_TO_DISPLAY: 20, // Maximum number of links to display from web pages
  MAX_CONTENT_LENGTH: 25000, // Maximum length of content to extract from web pages

  API_TIMEOUT: 180000, // 180 seconds for API requests

  SPINNER_INTERVAL: 100, // Spinner update interval in ms
  CLEAR_TIMEOUT: 100, // Timeout for screen clear

  CACHE_ENABLED: false, // Temporarily disabled - will implement history/conversation saving later

  CLIPBOARD_MARKER: '$$',

  SYSTEM_PROMPTS: {
    DISABLE_MARKDOWN:
      'CRITICAL INSTRUCTION: You are FORBIDDEN from using formatting symbols: NO asterisks (*), NO underscores (_), NO hash symbols (#), NO backticks (`), NO bold, NO italic. Output MUST be completely plain text only. This is NON-NEGOTIABLE.',
  },

  MENU_PAGE_SIZE: 10, // Number of options to display on one page in interactive menu
  MENU_CANCELLED_INDEX: -1, // Index returned when menu is cancelled
  FIELD_VALUE_MAX_LENGTH: 30, // Max length for field values display
  MENU_FIELD_NAME_WIDTH: 12, // Fixed width for field names (longest is "Description": 11 chars)

  REGEX: {
    API_KEY_OPENAI: /^sk-[a-zA-Z0-9\-_]{20,}$/,
    API_KEY_DEEPSEEK: /^sk-[a-zA-Z0-9\-_]{20,}$/,
    API_KEY_ANTHROPIC: /^sk-ant-api03-[a-zA-Z0-9\-_]{95}$/,
  },
}

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
}

export const SUPPORTED_PLATFORMS = {
  DARWIN: 'darwin', // macOS
  LINUX: 'linux',
  WIN32: 'win32', // Windows
}

export const CLIPBOARD_COMMANDS = {
  [SUPPORTED_PLATFORMS.DARWIN]: 'pbpaste',
  [SUPPORTED_PLATFORMS.LINUX]: 'xclip -selection clipboard -o',
  [SUPPORTED_PLATFORMS.WIN32]: 'powershell.exe -command "Get-Clipboard"',
}

export const BROWSER_COMMANDS = {
  [SUPPORTED_PLATFORMS.DARWIN]: 'open',
  [SUPPORTED_PLATFORMS.LINUX]: 'xdg-open',
  [SUPPORTED_PLATFORMS.WIN32]: 'start',
}

export const UI_SYMBOLS = {
  SPINNER: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  CHECK: '✓',
  CROSS: '☓',
  BRAILLE_DOTS: ['⡀', '⣀', '⣠', '⣤', '⣴', '⣶', '⣾', '⣿'],
  ARROW: '▶',
}

export const UI_CONFIG = {
  HELP_TABLE: {
    COLUMN_WIDTHS: {
      KEYS: 14,
      DESCRIPTION: 36,
      CACHE: 5,
      MODELS: 6,
    },
    SEPARATORS: {
      COLUMN: '│',
      ROW: '─',
    },
    FORMATTING: {
      ROW_INDENT: 0,
      SEPARATOR_SPACES: 0,
      SEPARATOR_COUNT: 0,
    },
  },
}
