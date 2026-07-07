import { logger } from '../utils/logger.js'
import { createProviderFactory } from '../utils/providers/factory.js'
import { configService } from '../services/config/index.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { EventEmitter } from 'node:events'

// Event emitter for StateManager events (Single Source of Truth)
export const stateManagerEvents = new EventEmitter()

function createStateManager() {
  // Initialize provider factory
  const providerFactory = createProviderFactory()

  // Private state with closures
  const aiState = {
    currentProvider: null, // Current provider instance
    currentProviderKey: '', // Current provider key (openai, deepseek, etc)
    currentModel: '', // Current model ID
    availableModels: [], // Models for current provider
    providers: new Map(), // All initialized providers
    initialized: false, // Service initialization status
  }

  // Operation state tracking
  const operationState = {
    isProcessingRequest: false,
    isTypingResponse: false,
    isRetryingProvider: false,
  }

  // Request management
  const requestState = {
    currentRequestController: null,
    currentSpinnerInterval: null,
    currentStreamProcessor: null,
  }

  // Context and conversation history
  const contextState = {
    contextHistory: [],
    maxContextHistory: APP_CONSTANTS.MAX_CONTEXT_HISTORY,
  }



  // === MAIN OPERATIONS - StateManager handles switching ===

  // Single reusable path from a provider's EFFECTIVE config (built-in defaults +
  // user overlay, incl. proxy) to a ready client. This is the ONLY place the
  // overlay reaches a provider, so proxy routing applies uniformly to every
  // caller (one-shot, REPL, multi-model). listModels is intentionally NOT here —
  // the caller decides whether it needs the model list.
  async function createProviderInstance(providerId) {
    const config = configService.getProviderConfig(providerId)
    if (!config) {
      throw new Error(`Unknown provider: ${providerId}`)
    }
    if (!config.token && !process.env[config.apiKeyEnv]) {
      throw new Error(`${config.name} not configured (needs a gateway token or ${config.apiKeyEnv})`)
    }
    const instance = providerFactory.createProvider(providerId, config)
    await instance.initializeClient()
    return { instance, config }
  }

  async function ensureProviderInitialized(providerId) {
    let providerData = aiState.providers.get(providerId)

    if (!providerData) {
      logger.debug(`StateManager: Lazy-loading provider ${providerId}`)
      const { instance, config } = await createProviderInstance(providerId)
      const models = await instance.listModels()
      providerData = { instance, config, models }
      aiState.providers.set(providerId, providerData)
    }

    return providerData
  }

  // Fast provider setup for one-shot mode: create the client but skip listModels().
  // The request path then cache-hits this entry instead of doing a network round-trip.
  async function primeProvider(providerId, model = null) {
    let providerData = aiState.providers.get(providerId)
    if (!providerData) {
      const { instance, config } = await createProviderInstance(providerId)
      providerData = { instance, config, models: [] }
      aiState.providers.set(providerId, providerData)
    }

    updateAIProvider({
      instance: providerData.instance,
      key: providerId,
      model: model || providerData.config.defaultModel,
      models: providerData.models,
      config: providerData.config,
    })

    return providerData
  }

  async function switchProvider(providerId, targetModel = null) {
    try {
      logger.debug(`StateManager: Switching to provider ${providerId}`)

      // Use common initialization logic
      const providerData = await ensureProviderInitialized(providerId)

      // Determine target model
      let selectedModel = targetModel
      if (!selectedModel) {
        // Use default model from config first, then fall back to first available
        const defaultModel = providerData.config.defaultModel
        if (
          defaultModel &&
          providerData.models.some((m) =>
            typeof m === 'string' ? m === defaultModel : m.id === defaultModel,
          )
        ) {
          selectedModel = defaultModel
        } else if (providerData.models.length > 0) {
          // Fall back to first available model
          selectedModel =
            typeof providerData.models[0] === 'string'
              ? providerData.models[0]
              : providerData.models[0].id
        }
      }

      // Update global state (only difference from createChatCompletion)
      updateAIProvider({
        instance: providerData.instance,
        key: providerId,
        model: selectedModel,
        models: providerData.models,
        config: providerData.config,
      })

      logger.debug(
        `StateManager: Successfully switched to ${providerId} with ${providerData.models.length} models`,
      )
      return {
        provider: providerData.instance,
        model: selectedModel,
        models: providerData.models,
      }
    } catch (error) {
      logger.debug(`StateManager: Provider switch failed: ${error.message}`)
      throw error
    }
  }

  async function switchModel(targetModel) {
    try {
      if (!aiState.currentProvider) {
        throw new Error('No provider currently active')
      }

      // Verify model exists
      const modelExists = aiState.availableModels.some((m) => {
        return typeof m === 'string'
          ? m === targetModel
          : m.id === targetModel || m.name === targetModel
      })

      if (!modelExists) {
        throw new Error(
          `Model ${targetModel} not available for current provider`,
        )
      }

      // Update current model
      updateModel(targetModel)

      logger.debug(
        `StateManager: Successfully switched to model ${targetModel}`,
      )
      return targetModel
    } catch (error) {
      logger.debug(`StateManager: Model switch failed: ${error.message}`)
      throw error
    }
  }

  // === AI State Management ===

  function updateAIProvider(providerInfo) {
    const previousProvider = aiState.currentProviderKey

    aiState.currentProvider = providerInfo.instance
    aiState.currentProviderKey = providerInfo.key
    aiState.currentModel = providerInfo.model
    aiState.availableModels = providerInfo.models || []

    // Store provider in map for future use
    if (providerInfo.instance) {
      aiState.providers.set(providerInfo.key, {
        instance: providerInfo.instance,
        config: providerInfo.config,
        models: providerInfo.models || [],
      })
    }

    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = aiState.currentModel
    }

    stateManagerEvents.emit('ai-provider-changed', {
      previous: previousProvider,
      current: providerInfo.key,
      model: providerInfo.model,
    })
  }

  function updateModel(modelId) {
    const previousModel = aiState.currentModel
    aiState.currentModel = modelId

    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = modelId
    }

    stateManagerEvents.emit('model-changed', {
      previous: previousModel,
      current: modelId,
    })
  }

  function getAIState() {
    return { ...aiState }
  }

  function getCurrentProvider() {
    if (!aiState.currentProvider) return null
    return {
      instance: aiState.currentProvider,
      key: aiState.currentProviderKey,
      model: aiState.currentModel,
    }
  }

  function getCurrentModel() {
    return aiState.currentModel
  }

  function getAvailableModels() {
    // Lazy loading - if no models but provider exists, load them
    if (aiState.availableModels.length === 0 && aiState.currentProviderKey) {
      const providerData = aiState.providers.get(aiState.currentProviderKey)
      if (providerData && providerData.models) {
        aiState.availableModels = providerData.models
      }
    }
    return [...aiState.availableModels]
  }

  function getProvider(key) {
    return aiState.providers.get(key)
  }

  // === Operation State Management ===

  function setProcessingRequest(isProcessing, controller = null) {
    operationState.isProcessingRequest = isProcessing

    // Only update controller if explicitly provided, otherwise keep existing
    if (controller !== null) {
      requestState.currentRequestController = controller

      // Emit abort signal change event for Event-Driven AbortSignal management
      stateManagerEvents.emit('abort-signal-changed', controller.signal)
    }

    stateManagerEvents.emit('processing-state-changed', {
      isProcessing,
      hasController: !!requestState.currentRequestController,
    })
  }

  function setTypingResponse(isTyping) {
    operationState.isTypingResponse = isTyping
    stateManagerEvents.emit('typing-state-changed', { isTyping })
  }

  // === Request State Management ===

  function setStreamProcessor(processor) {
    requestState.currentStreamProcessor = processor
  }

  function setSpinnerInterval(interval) {
    requestState.currentSpinnerInterval = interval
  }

  function notifyAbortSignalCleared() {
    // Reset the output gate so post-request output (incl. shutdown messages) is not suppressed
    stateManagerEvents.emit('abort-signal-changed', null)
  }

  function clearRequestState() {
    requestState.currentRequestController = null
    requestState.currentSpinnerInterval = null
    requestState.currentStreamProcessor = null
    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
    notifyAbortSignalCleared()
  }

  function isTypingResponse() {
    return operationState.isTypingResponse
  }

  function isProcessingRequest() {
    return operationState.isProcessingRequest
  }

  function getSpinnerInterval() {
    return requestState.currentSpinnerInterval
  }

  function getCurrentRequestController() {
    return requestState.currentRequestController
  }

  function getCurrentStreamProcessor() {
    return requestState.currentStreamProcessor
  }

  function clearRequestController() {
    requestState.currentRequestController = null
    notifyAbortSignalCleared()
  }

  function clearAllOperations() {
    // Clear all request and operation state
    clearRequestState()

    // Reset operation flags
    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
    operationState.isRetryingProvider = false

    // Notify listeners - DatabaseCommandService should listen to this event
    // and handle its own cache invalidation (Single Source of Truth principle)
    stateManagerEvents.emit('all-operations-cleared', {
      timestamp: Date.now(),
    })

    logger.debug('StateManager: All operations cleared and state reset')
  }

  // === Context Management ===

  function addToContext(role, content) {
    contextState.contextHistory.push({ role, content })

    // Trim history if too long
    if (contextState.contextHistory.length > contextState.maxContextHistory) {
      contextState.contextHistory = contextState.contextHistory.slice(
        -contextState.maxContextHistory,
      )
    }

    stateManagerEvents.emit('context-updated', {
      role,
      content,
      historyLength: contextState.contextHistory.length,
    })
  }

  function clearContext() {
    contextState.contextHistory = []
    stateManagerEvents.emit('context-cleared', {})
  }

  function getContextHistory() {
    return [...contextState.contextHistory]
  }



  // === Create AI completion (main operation) ===

  async function createChatCompletion(
    messages,
    options = {},
    providerModel = null,
  ) {
    // Determine provider key for markdown setting
    const providerKey = providerModel
      ? providerModel.provider
      : aiState.currentProviderKey

    // Check if markdown should be disabled for this provider
    const providerConfig = configService.getProviderConfig(providerKey)
    if (providerConfig && !providerConfig.markdown) {
      // Add system prompt to disable markdown
      messages = [
        {
          role: 'system',
          content: APP_CONSTANTS.SYSTEM_PROMPTS.DISABLE_MARKDOWN,
        },
        ...messages,
      ]
    }

    // No specific provider+model - use current global state
    if (!providerModel) {
      if (!aiState.currentProvider) {
        throw new Error('No AI provider currently active')
      }

      try {
        return await aiState.currentProvider.createChatCompletion(
          aiState.currentModel,
          messages,
          options,
        )
      } catch (error) {
        // if (options.signal && options.signal.aborted) {
        if (options.signal.aborted) {
          throw error // User cancelled - don't log as error
        }
        logger.debug(
          `StateManager: Chat completion failed for current model ${aiState.currentModel}:`,
          error,
        )
        throw error
      }
    }

    // Specific provider+model from command - ensure provider is initialized
    const targetProviderKey = providerModel.provider
    const targetModel = providerModel.model

    logger.debug(
      `StateManager: Using specific provider ${targetProviderKey} with model ${targetModel}`,
    )

    // Use common initialization logic (no global state change)
    const providerData = await ensureProviderInitialized(targetProviderKey)

    try {
      return await providerData.instance.createChatCompletion(
        targetModel,
        messages,
        options,
      )
    } catch (error) {
      // if (options.signal && options.signal.aborted) {
      if (options.signal.aborted) {
        throw error // User cancelled - don't log as error
      }
      logger.debug(
        `StateManager: Chat completion failed for ${targetProviderKey}:${targetModel}:`,
        error,
      )
      throw error
    }
  }

  // Return the functional object (NO CLASS!)
  return {
    // Main operations
    switchProvider,
    primeProvider,
    switchModel,
    createChatCompletion,

    // AI state getters
    getAIState,
    getCurrentProvider,
    getCurrentModel,
    getAvailableModels,
    getProvider,

    // AI state setters (internal)
    updateAIProvider,
    updateModel,

    // Operation state
    setProcessingRequest,
    setTypingResponse,

    // Request state
    setStreamProcessor,
    setSpinnerInterval,
    isTypingResponse,
    isProcessingRequest,
    getSpinnerInterval,
    getCurrentRequestController,
    getCurrentStreamProcessor,
    clearRequestController,
    clearAllOperations,

    // Context management
    addToContext,
    clearContext,
    getContextHistory,
  }
}

let stateManagerInstance = null

export function getStateManager() {
  if (!stateManagerInstance) {
    stateManagerInstance = createStateManager()
  }
  return stateManagerInstance
}

