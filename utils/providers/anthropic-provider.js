import { createBaseError } from '../../core/error-system/index.js'
import { createBaseProvider } from './base-provider.js'

export const createAnthropicProvider = (config) => {
  const base = createBaseProvider(config)
  
  base.validateConfig()
  const apiKey = base.getApiKey()

  const initializeClient = async () => {
    if (!apiKey) {
      throw createBaseError('Anthropic API key is required', true, 401)
    }
  }

  const makeRequest = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...options.headers
      }
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      throw new Error(error.error?.message || 'API request failed')
    }

    return response
  }

  const listModels = async () => {
    base.rateLimiter.recordRequest()
    const startTime = Date.now()

    try {
      const response = await makeRequest('https://api.anthropic.com/v1/models')
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime)

      const data = await response.json()
      return data.data || []
    } catch (error) {
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime, error)
      throw createBaseError(`Failed to list Anthropic models: ${error.message}`, true, 500)
    }
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    base.rateLimiter.recordRequest()
    const startTime = Date.now()

    const { signal, ...apiOptions } = options

    try {
      // Filter out empty messages (Anthropic doesn't allow empty content)
      const filteredMessages = messages.filter(msg => 
        msg.content && msg.content.trim().length > 0
      )

      const requestBody = {
        model,
        messages: filteredMessages,
        stream: apiOptions.stream || true,
        max_tokens: apiOptions.max_tokens || 4096,
        ...apiOptions
      }

      const response = await makeRequest('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        ...(signal && { signal }),
        body: JSON.stringify(requestBody)
      })

      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime)

      return response.body
    } catch (error) {
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime, error)

      if (signal && signal.aborted) {
        throw new Error('AbortError')
      }

      throw createBaseError(`Failed to create Anthropic chat completion: ${error.message}`, true, 500)
    }
  }

  const validateModel = async (modelId) => {
    try {
      const models = await listModels()
      return models.some(model => model.id === modelId)
    } catch (error) {
      return false
    }
  }

  return {
    ...base,
    initializeClient,
    makeRequest,
    listModels,
    createChatCompletion,
    validateModel
  }
}