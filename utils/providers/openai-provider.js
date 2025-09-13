import { createBaseError } from '../../core/error-system/index.js'
import { createBaseProvider } from './base-provider.js'

export const createOpenAIProvider = (config) => {
  const base = createBaseProvider(config)
  let client = null
  
  base.validateConfig()

  const initializeClient = async () => {
    try {
      const { OpenAI } = await import('openai')
      client = new OpenAI({
        baseURL: config.baseURL,
        apiKey: base.getApiKey(),
        timeout: config.timeout || 180000
      })
    } catch (error) {
      throw createBaseError(`Failed to initialize OpenAI client: ${error.message}`, true, 500)
    }
  }

  const listModels = async () => {
    base.rateLimiter.recordRequest()
    const startTime = Date.now()

    try {
      const response = await client.models.list()
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime)

      return response.data.sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) {
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime, error)
      throw createBaseError(`Failed to list models: ${error.message}`, true, 500)
    }
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    base.rateLimiter.recordRequest()
    const startTime = Date.now()

    const { signal, ...apiOptions } = options

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        stream: apiOptions.stream || true,
        ...apiOptions
      }, signal ? { signal } : {})

      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime)

      return response
    } catch (error) {
      const responseTime = Date.now() - startTime
      base.recordRequest(responseTime, error)

      if (signal && signal.aborted) {
        throw new Error('AbortError')
      }

      throw createBaseError(`Failed to create chat completion: ${error.message}`, true, 500)
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
    listModels,
    createChatCompletion,
    validateModel
  }
}