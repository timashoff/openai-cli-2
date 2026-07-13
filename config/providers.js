export const PROVIDER_DEFAULTS = {
  RATE_LIMIT_REQUESTS: 10,
  RATE_LIMIT_WINDOW: 60000,
  REQUIRED_FIELDS: ['name', 'baseURL', 'apiKeyEnv']
}

// Which completion endpoint an OpenAI-SDK-shaped provider speaks.
// Absent `api` field on a provider ⇒ CHAT (chat/completions).
export const PROVIDER_API = {
  CHAT: 'chat',
  RESPONSES: 'responses',
}

export const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash',
    markdown: false,
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    // Geo-blocked from the owner's region → route through the gateway when one is
    // configured (see services/config/gateway.js). SSOT for "needs the gateway".
    gateway: true,
    // Responses-only models (gpt-5.5-pro & kin) 404 on chat/completions;
    // the Responses API serves classic chat models too, so ALL openai
    // calls go through it. User escape hatch: config.toml api = 'chat'.
    api: PROVIDER_API.RESPONSES,
    // Owner's pick: chain-robust. gpt-5.4-mini mis-routes chained translation
    // dialogues 2-23% of turns (measured 2026-07-13); luna was 0/90.
    defaultModel: 'gpt-5.6-luna',
    markdown: true,
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    isClaude: true,
    gateway: true,
    defaultModel: 'claude-sonnet-5',
    markdown: true,
  },
}
