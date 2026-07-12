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

export const USER_CONFIG = {
  DIR_NAME: '.openai-cli', // user config directory under the home folder
  COMMANDS_FILE: 'commands.toml', // user-editable command definitions
  CONFIG_FILE: 'config.toml', // user-editable provider overrides (gateway baseURL/token)
  LEGACY_DB: 'commands.db', // pre-TOML sqlite store, migrated once then renamed
  BACKUP_SUFFIX: '.bak',
  SESSIONS_DIR: 'sessions', // saved conversation records (JSON, machine-managed)
}

export const SESSIONS = {
  TITLE_MAX_LENGTH: 48, // auto-proposed title cut-off
  MAX_ROW_BYTES: 400000, // per-session sync payload guard (gateway caps POST at 512KB)
}

// Stateful dialogue-translation mode (dd). Templates use {a}/{b}/{pivot}
// placeholders — filled at runtime, languages never hardcoded in logic.
export const DIALOGUE = {
  DEFAULT_PAIR: ['Russian', 'Chinese'],
  LANGUAGES: ['Russian', 'English', 'Chinese'], // selectable set; the pair menu derives every combination
  LANGUAGE_CODES: { ru: 'Russian', en: 'English', zh: 'Chinese' }, // quick form `dd ru en`; unknown args pass through
  PIVOT_LANGUAGE: 'English',
  PIVOT_ENABLED: true, // default for new dialogues
  PIVOT_LABEL: 'en', // per-turn leg1 marker (source -> pivot)
  TARGET_LABEL: '->', // final translation marker (direction is model-detected)
  PROMPT: '[dialogue] ', // in-mode prompt (dd is only the launch keyword)
  SETTINGS_FILE: 'dialogue.json', // persisted defaults under the user config dir
  LEG1_INSTRUCTIONS:
    'You relay a live dialogue between a {a} speaker and a {b} speaker. The user message is from one of them. Translate it into {pivot}, preserving tone, register and the terminology already used in this dialogue. Output nothing but the {pivot} translation.',
  LEG2_INSTRUCTIONS:
    'You relay a live dialogue between a {a} speaker and a {b} speaker. You are given an original message and its {pivot} translation. Produce the final translation into the OTHER language of the pair (into {b} if the original is in {a}, into {a} if it is in {b}). Rely on the {pivot} version, checking the original for nuance. Output nothing but the final translation.',
  DIRECT_INSTRUCTIONS:
    'You relay a live dialogue between a {a} speaker and a {b} speaker. The user message is from one of them. Translate it directly into the OTHER language of the pair (into {b} if the message is in {a}, into {a} if it is in {b}), preserving tone, register and the terminology already used in this dialogue. Output nothing but the translation.',
}

export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  SIGINT: 130, // 128 + SIGINT(2), conventional shell code for Ctrl+C
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
  CONTEXT_CHAIN: '∞',
  ARROW: '▶',
}

export const UI_CONFIG = {
  HELP_TABLE: {
    COLUMN_WIDTHS: {
      KEYS: 14,
      DESCRIPTION: 36,
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
