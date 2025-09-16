import { logger } from '../utils/logger.js'
import { createProviderFactory } from '../utils/providers/factory.js'
import { PROVIDERS } from '../config/providers.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { logError, processError } from './error-system/index.js'
import { EventEmitter } from 'node:events'

// Event emitter for StateManager events (Single Source of Truth)
const stateManagerEmitter = new EventEmitter()

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
    shouldReturnToPrompt: false,
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


  // State change listeners
  const listeners = new Map()

  // === MAIN OPERATIONS - StateManager handles switching ===

  async function ensureProviderInitialized(providerId) {
    // Check if provider is available
    const providerConfig = PROVIDERS[providerId]
    // if (!providerConfig) { //   throw new Error(`Unknown provider: ${providerId}`) // }

    if (!process.env[providerConfig.apiKeyEnv]) {
      throw new Error(`${providerConfig.name} API key not found`)
    }

    // Get or create provider instance
    let providerData = aiState.providers.get(providerId)

    if (!providerData) {
      // Lazy-loading: create new provider
      logger.debug(`StateManager: Lazy-loading provider ${providerId}`)

      const providerInstance = providerFactory.createProvider(providerId, providerConfig)
      await providerInstance.initializeClient()
      const models = await providerInstance.listModels()

      // Store in cache for future use
      providerData = {
        instance: providerInstance,
        config: providerConfig,
        models: models,
      }
      aiState.providers.set(providerId, providerData)
    }

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
        const defaultModel = PROVIDERS[providerId].defaultModel
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

    notifyListeners('ai-provider-changed', {
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

    notifyListeners('model-changed', {
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

  function getCurrentProviderKey() {
    return aiState.currentProviderKey
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

  function setProvider(key, providerData) {
    aiState.providers.set(key, providerData)
  }

  function getProvider(key) {
    return aiState.providers.get(key)
  }

  function getAllProviders() {
    return aiState.providers
  }

  function setServiceInitialized(initialized) {
    aiState.initialized = initialized
  }

  // === Operation State Management ===

  function setProcessingRequest(isProcessing, controller = null) {
    operationState.isProcessingRequest = isProcessing

    // Only update controller if explicitly provided, otherwise keep existing
    if (controller !== null) {
      requestState.currentRequestController = controller

      // Emit abort signal change event for Event-Driven AbortSignal management
      stateManagerEmitter.emit('abort-signal-changed', controller.signal)
    }

    notifyListeners('processing-state-changed', {
      isProcessing,
      hasController: !!requestState.currentRequestController,
    })
  }

  function setTypingResponse(isTyping) {
    operationState.isTypingResponse = isTyping
    notifyListeners('typing-state-changed', { isTyping })
  }


  function getOperationState() {
    return { ...operationState }
  }

  // === Request State Management ===

  function setStreamProcessor(processor) {
    requestState.currentStreamProcessor = processor
  }

  function setSpinnerInterval(interval) {
    requestState.currentSpinnerInterval = interval
  }

  function clearRequestState() {
    requestState.currentRequestController = null
    requestState.currentSpinnerInterval = null
    requestState.currentStreamProcessor = null
    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
  }

  function setCurrentRequestController(controller) {
    requestState.currentRequestController = controller
  }

  function setShouldReturnToPrompt(shouldReturn) {
    operationState.shouldReturnToPrompt = shouldReturn
  }

  function shouldReturnToPrompt() {
    return operationState.shouldReturnToPrompt
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
    notifyListeners('controller-cleared', {
      timestamp: Date.now(),
    })
  }

  function clearAllOperations() {
    // Clear all request and operation state
    clearRequestState()

    // Reset operation flags
    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
    operationState.isRetryingProvider = false
    operationState.shouldReturnToPrompt = false

    // Notify listeners - DatabaseCommandService should listen to this event
    // and handle its own cache invalidation (Single Source of Truth principle)
    notifyListeners('all-operations-cleared', {
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

    notifyListeners('context-updated', {
      role,
      content,
      historyLength: contextState.contextHistory.length,
    })
  }

  function clearContext() {
    contextState.contextHistory = []
    notifyListeners('context-cleared', {})
  }

  function getContextHistory() {
    return [...contextState.contextHistory]
  }



  // === Event Listener Management ===

  function addListener(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set())
    }
    listeners.get(event).add(callback)
  }

  function removeListener(event, callback) {
    if (listeners.has(event)) {
      listeners.get(event).delete(callback)
    }
  }

  function notifyListeners(event, data) {
    if (listeners.has(event)) {
      listeners.get(event).forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          // Use async IIFE for processError in event listener
          ;(async () => {
            const processedError = await processError(error, { context: 'StateManager:eventListener', component: event })
            await logError(processedError)
          })()
        }
      })
    }
  }

  // === Utility Methods ===


  function reset() {
    aiState.currentProvider = null
    aiState.currentProviderKey = ''
    aiState.currentModel = ''
    aiState.availableModels = []
    aiState.providers.clear()
    aiState.initialized = false

    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
    operationState.isRetryingProvider = false
    operationState.shouldReturnToPrompt = false

    clearRequestState()
    clearContext()

    notifyListeners('state-reset', {})
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
    const providerConfig = PROVIDERS[providerKey]
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
    switchModel,
    createChatCompletion,

    // AI state getters
    getAIState,
    getCurrentProvider,
    getCurrentProviderKey,
    getCurrentModel,
    getAvailableModels,
    setProvider,
    getProvider,
    getAllProviders,
    setServiceInitialized,

    // AI state setters (internal)
    updateAIProvider,
    updateModel,

    // Operation state
    setProcessingRequest,
    setTypingResponse,
    getOperationState,

    // Request state
    setStreamProcessor,
    setSpinnerInterval,
    clearRequestState,
    setCurrentRequestController,
    setShouldReturnToPrompt,
    shouldReturnToPrompt,
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


    // Event listeners
    addListener,
    removeListener,
    notifyListeners,

    // Utilities
    reset,
  }
}

let stateManagerInstance = null

export function getStateManager() {
  if (!stateManagerInstance) {
    stateManagerInstance = createStateManager()
  }
  return stateManagerInstance
}

export function resetStateManager() {
  if (stateManagerInstance) {
    stateManagerInstance.reset()
  }
  stateManagerInstance = null
}

// Export StateManager events for Event-Driven architecture
export { stateManagerEmitter as stateManagerEvents }
