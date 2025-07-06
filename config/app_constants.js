export const APP_COMMANDS = {
  EXIT: 'exit',
  HELP: 'help',
  PROVIDER: 'provider',
  MODEL: 'model',
  CLEAR: 'clear',
  HISTORY: 'history'
}

export const STREAM_MARKERS = {
  CLAUDE_DATA_PREFIX: 'data: ',
  CLAUDE_DONE_MARKER: '[DONE]',
  CLAUDE_EVENT_PREFIX: 'event:',
  CLAUDE_COMMENT_PREFIX: ':'
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export const TIMING_CONFIG = {
  SPINNER_INTERVAL: 100,
  TYPING_DELAY: 10,
  CLEAR_TIMEOUT: 100
}

export const CLIPBOARD_MARKER = '$$'

export const FORCE_FLAGS = [' --force', ' -f']