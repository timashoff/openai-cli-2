import { createBaseError } from '../../core/error-system/index.js'
import { createBaseProvider } from './base-provider.js'
import { PROVIDER_API } from '../../config/providers.js'

export const createOpenAIProvider = (config) => {
  const base = createBaseProvider(config)
  let client = null

  base.validateConfig()

  const initializeClient = async () => {
    try {
      const { OpenAI } = await import('openai')
      // baseURL points at the provider directly, or at a gateway; getCredential
      // returns the gateway token or the env API key accordingly.
      client = new OpenAI({
        baseURL: config.baseURL,
        apiKey: base.getCredential(),
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
      const status = error && error.status ? error.status : 500
      const wrapped = createBaseError(`Failed to list models: ${error.message}`, true, status, error)
      if (error && error.code === 'GATEWAY_SESSION_INVALID') wrapped.gatewaySession = true
      throw wrapped
    }

    return result
  }

  const wrapApiError = (error, signal) => {
    if (signal && signal.aborted) {
      throw new Error('AbortError')
    }
    const status = error && error.status ? error.status : 500
    const wrapped = createBaseError(`Failed to create chat completion: ${error.message}`, true, status, error)
    if (error && error.code === 'GATEWAY_SESSION_INVALID') wrapped.gatewaySession = true
    throw wrapped
  }

  const createResponsesCompletion = async (model, messages, options = {}) => {
    const { signal, ...apiOptions } = options

    const { result, error } = await base.measureTime(async () => {
      return await client.responses.create({
        model,
        input: messages,
        stream: apiOptions.stream || true,
        // M1 is stateless; M2 flips store/previous_response_id via options
        store: false,
        ...apiOptions
      }, signal ? { signal } : {})
    })

    if (error) wrapApiError(error, signal)

    return result
  }

  const createChatCompletion = async (model, messages, options = {}) => {
    if (config.api === PROVIDER_API.RESPONSES) {
      return createResponsesCompletion(model, messages, options)
    }

    const { signal, ...apiOptions } = options

    const { result, error } = await base.measureTime(async () => {
      return await client.chat.completions.create({
        model,
        messages,
        stream: apiOptions.stream || true,
        ...apiOptions
      }, signal ? { signal } : {})
    })

    if (error) wrapApiError(error, signal)

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
    validateModel
  }
}