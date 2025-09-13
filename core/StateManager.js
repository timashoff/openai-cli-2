import { logger } from '../utils/logger.js'
import { createProviderFactory } from '../utils/providers/factory.js'
import { PROVIDERS } from '../config/providers.js'
import { APP_CONSTANTS } from '../config/constants.js'

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

  // User session data
  let userSession = {}

  // State change listeners
  const listeners = new Map()

  // === MAIN OPERATIONS - StateManager handles switching ===

  /**
   * Ensure provider is initialized (lazy-loading) without changing global state
   */
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

  /**
   * Switch AI provider (main operation)
   */
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

  /**
   * Switch AI model (main operation)
   */
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

  /**
   * Update AI provider state - Single Source of Truth
   */
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

  /**
   * Update current model
   */
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

  /**
   * Get current AI state
   */
  function getAIState() {
    return { ...aiState }
  }

  /**
   * Get current provider with metadata
   */
  function getCurrentProvider() {
    if (!aiState.currentProvider) return null
    return {
      instance: aiState.currentProvider,
      key: aiState.currentProviderKey,
      model: aiState.currentModel,
    }
  }

  /**
   * Get current provider key
   */
  function getCurrentProviderKey() {
    return aiState.currentProviderKey
  }

  /**
   * Get current model
   */
  function getCurrentModel() {
    return aiState.currentModel
  }

  /**
   * Get available models for current provider with lazy loading
   */
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

  /**
   * Set provider in map
   */
  function setProvider(key, providerData) {
    aiState.providers.set(key, providerData)
  }

  /**
   * Get provider from map
   */
  function getProvider(key) {
    return aiState.providers.get(key)
  }

  /**
   * Get all providers
   */
  function getAllProviders() {
    return aiState.providers
  }

  /**
   * Set service initialization status
   */
  function setServiceInitialized(initialized) {
    aiState.initialized = initialized
  }

  // === Operation State Management ===

  /**
   * Set processing request state
   */
  function setProcessingRequest(isProcessing, controller = null) {
    operationState.isProcessingRequest = isProcessing

    // Only update controller if explicitly provided, otherwise keep existing
    if (controller !== null) {
      requestState.currentRequestController = controller
    }

    notifyListeners('processing-state-changed', {
      isProcessing,
      hasController: !!requestState.currentRequestController,
    })
  }

  /**
   * Set typing response state
   */
  function setTypingResponse(isTyping) {
    operationState.isTypingResponse = isTyping
    notifyListeners('typing-state-changed', { isTyping })
  }

  /**
   * Set provider retry state
   */
  function setRetryingProvider(isRetrying) {
    operationState.isRetryingProvider = isRetrying
    notifyListeners('retry-state-changed', { isRetrying })
  }

  /**
   * Get current operation state
   */
  function getOperationState() {
    return { ...operationState }
  }

  // === Request State Management ===

  /**
   * Set current stream processor
   */
  function setStreamProcessor(processor) {
    requestState.currentStreamProcessor = processor
  }

  /**
   * Set spinner interval
   */
  function setSpinnerInterval(interval) {
    requestState.currentSpinnerInterval = interval
  }

  /**
   * Clear all request state
   */
  function clearRequestState() {
    requestState.currentRequestController = null
    requestState.currentSpinnerInterval = null
    requestState.currentStreamProcessor = null
    operationState.isProcessingRequest = false
    operationState.isTypingResponse = false
  }

  /**
   * Set current request controller
   */
  function setCurrentRequestController(controller) {
    requestState.currentRequestController = controller
  }

  /**
   * Set should return to prompt flag
   */
  function setShouldReturnToPrompt(shouldReturn) {
    operationState.shouldReturnToPrompt = shouldReturn
  }

  /**
   * Check if should return to prompt
   */
  function shouldReturnToPrompt() {
    return operationState.shouldReturnToPrompt
  }

  /**
   * Check if currently typing response
   */
  function isTypingResponse() {
    return operationState.isTypingResponse
  }

  /**
   * Check if currently processing request
   */
  function isProcessingRequest() {
    return operationState.isProcessingRequest
  }

  /**
   * Get current spinner interval
   */
  function getSpinnerInterval() {
    return requestState.currentSpinnerInterval
  }

  /**
   * Get current request controller
   */
  function getCurrentRequestController() {
    return requestState.currentRequestController
  }

  /**
   * Get current stream processor
   */
  function getCurrentStreamProcessor() {
    return requestState.currentStreamProcessor
  }

  /**
   * Clear current request controller (explicit cleanup)
   */
  function clearRequestController() {
    requestState.currentRequestController = null
    notifyListeners('controller-cleared', {
      timestamp: Date.now(),
    })
  }

  /**
   * Clear all operations and reset state after errors/cancellation
   */
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

  /**
   * Add message to context history
   */
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

  /**
   * Clear context history
   */
  function clearContext() {
    contextState.contextHistory = []
    notifyListeners('context-cleared', {})
  }

  /**
   * Get context history
   */
  function getContextHistory() {
    return [...contextState.contextHistory]
  }

  /**
   * Set maximum context history length
   */
  function setMaxContextHistory(maxLength) {
    contextState.maxContextHistory = maxLength

    // Trim current history if needed
    if (contextState.contextHistory.length > maxLength) {
      contextState.contextHistory =
        contextState.contextHistory.slice(-maxLength)
    }
  }

  /**
   * Set context history directly
   */
  function setContextHistory(history) {
    contextState.contextHistory = [...history]
    notifyListeners('context-history-set', { length: history.length })
  }

  // === User Session Management ===

  /**
   * Update user session data
   */
  function updateUserSession(sessionData) {
    userSession = { ...userSession, ...sessionData }
    notifyListeners('session-updated', sessionData)
  }

  /**
   * Get user session data
   */
  function getUserSession() {
    return { ...userSession }
  }

  // === Event Listener Management ===

  /**
   * Add state change listener
   */
  function addListener(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, new Set())
    }
    listeners.get(event).add(callback)
  }

  /**
   * Remove state change listener
   */
  function removeListener(event, callback) {
    if (listeners.has(event)) {
      listeners.get(event).delete(callback)
    }
  }

  /**
   * Notify listeners of state change
   */
  function notifyListeners(event, data) {
    if (listeners.has(event)) {
      listeners.get(event).forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          console.error(
            `StateManager listener error for event ${event}:`,
            error,
          )
        }
      })
    }
  }

  // === Utility Methods ===

  /**
   * Get complete state snapshot
   */
  function getStateSnapshot() {
    return {
      aiState: getAIState(),
      operationState: getOperationState(),
      contextHistory: getContextHistory(),
      userSession: getUserSession(),
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Reset all state to initial values
   */
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
    userSession = {}

    notifyListeners('state-reset', {})
  }

  /**
   * Check if application is currently busy
   */
  function isBusy() {
    return (
      operationState.isProcessingRequest ||
      operationState.isTypingResponse ||
      operationState.isRetryingProvider
    )
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
    setRetryingProvider,
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
    setMaxContextHistory,
    setContextHistory,

    // User session
    updateUserSession,
    getUserSession,

    // Event listeners
    addListener,
    removeListener,
    notifyListeners,

    // Utilities
    getStateSnapshot,
    reset,
    isBusy,
  }
}

/**
 * Create and return a singleton StateManager instance
 */
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
