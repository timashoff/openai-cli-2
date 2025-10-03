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
    const { result, error } = await base.measureTime(async () => {
      const response = await client.models.list()
      return response.data.sort((a, b) => a.id.localeCompare(b.id))
    })

    if (error) {
      throw createBaseError(`Failed to list models: ${error.message}`, true, 500)
    }

    return result
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    const { signal, ...apiOptions } = options

    const { result, error } = await base.measureTime(async () => {
      return await client.chat.completions.create({
        model,
        messages,
        stream: apiOptions.stream || true,
        ...apiOptions
      }, signal ? { signal } : {})
    })

    if (error) {
      if (signal && signal.aborted) {
        throw new Error('AbortError')
      }
      throw createBaseError(`Failed to create chat completion: ${error.message}`, true, 500)
    }

    return result
  }

  const createResponseStream = async (params = {}) => {
    const { signal, ...streamParams } = params

    const { result, error } = await base.measureTime(async () => {
      return await client.responses.stream(
        {
          ...streamParams,
        },
        signal ? { signal } : {},
      )
    })

    if (error) {
      if (signal && signal.aborted) {
        throw new Error('AbortError')
      }
      throw createBaseError(`Failed to create response stream: ${error.message}`, true, 500)
    }

    return result
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
    createResponseStream,
    validateModel
  }
}
