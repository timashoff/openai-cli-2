/**
 * Application configuration - only actually used settings
 * Cleaned from 95% dead/unused overengineered configs
 */

export const APP_CONFIG = {
  // System prompts for different behaviors
  SYSTEM_PROMPTS: {
    DISABLE_MARKDOWN:
      'CRITICAL INSTRUCTION: You are FORBIDDEN from using formatting symbols: NO asterisks (*), NO underscores (_), NO hash symbols (#), NO backticks (`), NO bold, NO italic. Output MUST be completely plain text only. This is NON-NEGOTIABLE.',
  },

  // Help command table layout
  UI: {
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
  },

  // AI Provider configurations
  PROVIDERS: {
    deepseek: {
      name: 'DeepSeek',
      baseURL: 'https://api.deepseek.com/v1',
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultModel: 'deepseek-chat',
      maxTokens: 4096,
      temperature: 0.7,
      streaming: true,
      markdown: false,
    },
    openai: {
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      defaultModel: 'gpt-5-mini',
      maxTokens: 4096,
      temperature: 0.7,
      streaming: true,
      markdown: true,
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
      markdown: true,
    },
  },
}
