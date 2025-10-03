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
    const { result, error } = await base.measureTime(async () => {
      const response = await makeRequest('https://api.anthropic.com/v1/models')
      const data = await response.json()
      return data.data || []
    })

    if (error) {
      throw createBaseError(`Failed to list Anthropic models: ${error.message}`, true, 500)
    }

    return result
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    const { signal, ...apiOptions } = options

    const { result, error } = await base.measureTime(async () => {
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

      return response.body
    })

    if (error) {
      if (signal && signal.aborted) {
        throw new Error('AbortError')
      }
      throw createBaseError(`Failed to create Anthropic chat completion: ${error.message}`, true, 500)
    }

    return result
  }

  const createResponseStream = async () => {
    throw createBaseError('Responses API streaming is not supported for Anthropic provider yet', true, 501)
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
    createResponseStream,
    validateModel
  }
}
