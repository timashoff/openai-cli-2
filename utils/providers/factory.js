import { createBaseError } from '../../core/error-system/index.js'
import { logger } from '../logger.js'
import { validateObject } from '../validation.js'
import { createOpenAIProvider } from './openai-provider.js'
import { createAnthropicProvider } from './anthropic-provider.js'

export const createProviderFactory = () => {
  const state = {
    providers: new Map(),
    instances: new Map()
  }

  const registerBuiltinProviders = () => {
    registerProvider('openai', createOpenAIProvider)
    registerProvider('deepseek', createOpenAIProvider)
    registerProvider('anthropic', createAnthropicProvider)
  }

  const registerProvider = (type, providerFunction) => {
    if (typeof providerFunction !== 'function') {
      throw createBaseError('Provider must be a constructor function', true, 400)
    }

    state.providers.set(type, providerFunction)
    logger.debug(`Provider type ${type} registered`)
  }

  const createProvider = (type, config) => {
    const providerFunction = state.providers.get(type)
    if (!providerFunction) {
      throw createBaseError(`Unknown provider type: ${type}`, true, 404)
    }

    validateObject(config, 'provider config')

    try {
      const instance = providerFunction(config)
      const instanceId = `${type}:${config.name || 'default'}`
      state.instances.set(instanceId, instance)

      logger.debug(`Provider instance created: ${instanceId}`)
      return instance
    } catch (error) {
      throw createBaseError(`Failed to create provider ${type}: ${error.message}`, true, 500)
    }
  }

  const getProvider = (instanceId) => {
    return state.instances.get(instanceId)
  }

  const getAllProviders = () => {
    return Array.from(state.instances.values())
  }

  const getProviderStats = () => {
    const stats = {}

    for (const [id, provider] of state.instances) {
      stats[id] = provider.getStats()
    }

    return stats
  }

  const removeProvider = (instanceId) => {
    const removed = state.instances.delete(instanceId)
    if (removed) {
      logger.debug(`Provider instance removed: ${instanceId}`)
    }
    return removed
  }

  const getAvailableTypes = () => {
    return Array.from(state.providers.keys())
  }

  const validateProviderConfig = (type, config) => {
    const providerFunction = state.providers.get(type)
    if (!providerFunction) {
      throw createBaseError(`Unknown provider type: ${type}`, true, 404)
    }

    try {
      const tempInstance = providerFunction(config)
      tempInstance.validateConfig()
      return true
    } catch (error) {
      throw createBaseError(`Provider config validation failed: ${error.message}`, true, 400)
    }
  }

  registerBuiltinProviders()

  return {
    registerProvider,
    createProvider,
    getProvider,
    getAllProviders,
    getProviderStats,
    removeProvider,
    getAvailableTypes,
    validateProviderConfig
  }
}