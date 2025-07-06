import { validateApiKey, createSecureHeaders } from './security.js'
import { API_PROVIDERS } from '../config/api_providers.js'

/**
 * Handles API requests for different providers
 */
export class ApiHandler {
  constructor(selectedProviderKey) {
    this.selectedProviderKey = selectedProviderKey
    this.provider = API_PROVIDERS[selectedProviderKey]
  }

  /**
   * Validates API key for the current provider
   */
  validateCurrentApiKey() {
    const apiKey = process.env[this.provider.apiKeyEnv]
    const providerName = this.provider.isClaude ? 'anthropic' : this.selectedProviderKey
    validateApiKey(apiKey, providerName)
    return apiKey
  }

  /**
   * Creates API request stream for chat completion
   */
  async createChatStream(messages, model, signal, openai) {
    const apiKey = this.validateCurrentApiKey()

    if (this.provider.isClaude) {
      return this.createClaudeStream(messages, model, signal, apiKey)
    } else {
      return this.createOpenAIStream(messages, model, signal, openai)
    }
  }

  /**
   * Creates Claude API stream
   */
  async createClaudeStream(messages, model, signal, apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: createSecureHeaders(apiKey, 'anthropic'),
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 4096
      }),
      signal
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error.message)
    }

    return response.body
  }

  /**
   * Creates OpenAI-compatible API stream
   */
  async createOpenAIStream(messages, model, signal, openai) {
    return await openai.chat.completions.create(
      {
        model,
        messages,
        stream: true,
      },
      { signal }
    )
  }

  /**
   * Fetches models list from the provider
   */
  async fetchModels(openai) {
    const apiKey = this.validateCurrentApiKey()

    if (this.provider.isClaude) {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: createSecureHeaders(apiKey, 'anthropic')
      })
      
      const list = await response.json()
      if (!response.ok) {
        throw new Error(list.error.message)
      }
      return list
    } else {
      return await openai.models.list()
    }
  }
}