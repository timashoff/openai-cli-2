import { logger } from '../utils/logger.js'
import { createProviderFactory } from '../utils/providers/factory.js'
import { PROVIDERS } from '../config/providers.js'
import { APP_CONSTANTS } from '../config/constants.js'
import { logError, processError } from './error-system/index.js'
import { EventEmitter } from 'node:events'
import { agentProfileService } from '../services/agent-profile-service.js'
import { prepareResponseInput } from '../utils/message-utils.js'

// Event emitter for StateManager events (Single Source of Truth)
export const stateManagerEvents = new EventEmitter()

// Centralized error handling for EventEmitter (CLAUDE.md compliance)
stateManagerEvents.on('error', async (error) => {
  const processedError = await processError(error, {
    context: 'StateManager:EventSystem',
    component: 'stateManagerEvents'
  })
  await logError(processedError)
})

function createStateManager() {
  // Initialize provider factory
  const providerFactory = createProviderFactory()
  let agentProfilesCache = new Map()
  let lastProfileOwnerId = null

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
    stateManagerEvents.emit('controller-cleared', {
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


  // === Agent Profile Management ===

  async function loadAgentProfiles(options = {}) {
    const ownerId = options.ownerId || null
    try {
      const profiles = await agentProfileService.listProfiles({ ownerId })
      cacheAgentProfiles(profiles, ownerId)
      return profiles
    } catch (error) {
      const processedError = await processError(error, {
        context: 'StateManager:loadAgentProfiles',
        component: 'agentProfiles',
      })
      await logError(processedError)
      throw processedError.originalError || error
    }
  }

  async function reloadAgentProfiles(options = {}) {
    agentProfilesCache.clear()
    return await loadAgentProfiles(options)
  }

  function cacheAgentProfiles(profiles, ownerId) {
    lastProfileOwnerId = ownerId || null
    agentProfilesCache = new Map()
    for (const profile of profiles) {
      agentProfilesCache.set(profile.id, profile)
    }
  }

  async function getAgentProfiles({ ownerId = null } = {}) {
    if (ownerId !== lastProfileOwnerId || agentProfilesCache.size === 0) {
      const profiles = await agentProfileService.listProfiles({ ownerId })
      cacheAgentProfiles(profiles, ownerId)
      return profiles
    }
    return Array.from(agentProfilesCache.values())
  }

  async function getAgentProfile(profileId, options = {}) {
    if (agentProfilesCache.has(profileId)) {
      return agentProfilesCache.get(profileId)
    }
    const profile = await agentProfileService.getProfile(profileId)
    if (profile) {
      agentProfilesCache.set(profile.id, profile)
    }
    return profile
  }

  async function hasAgentProfile(profileId) {
    if (agentProfilesCache.has(profileId)) {
      return true
    }
    return await agentProfileService.profileExists(profileId)
  }

  async function getAgentProfileSummary(profileId) {
    const profile = await getAgentProfile(profileId)
    if (!profile) {
      return null
    }

    return {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      provider: profile.provider,
      instructionsPreview: profile.instructions
        ? profile.instructions.replace(/\s+/g, ' ').slice(0, 120) + (profile.instructions.length > 120 ? '…' : '')
        : '',
      tools: Array.isArray(profile.tools) ? profile.tools.map((tool) => (typeof tool === 'string' ? tool : tool.type || tool.name)).filter(Boolean) : [],
      metadata: profile.metadata || {},
    }
  }

  function getAgentProfileStats() {
    return {
      totalProfiles: agentProfilesCache.size,
      lastOwnerId: lastProfileOwnerId,
    }
  }

  async function createAgentProfile(profile) {
    const created = await agentProfileService.createProfile(profile)
    agentProfilesCache.set(created.id, created)
    return created
  }

  async function updateAgentProfile(id, profile) {
    const updated = await agentProfileService.updateProfile(id, profile)
    agentProfilesCache.set(updated.id, updated)
    return updated
  }

  async function deleteAgentProfile(id) {
    const removed = await agentProfileService.deleteProfile(id)
    if (removed) {
      agentProfilesCache.delete(id)
    }
    return removed
  }



  // === Event Listener Management ===

  function addListener(event, callback) {
    stateManagerEvents.on(event, callback)
  }

  function removeListener(event, callback) {
    stateManagerEvents.removeListener(event, callback)
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

    stateManagerEvents.emit('state-reset', {})
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

  async function createResponseStream({
    profile,
    userInput,
    signal,
    responseOptions = {},
  }) {
    if (!profile || !profile.id) {
      throw new Error('Agent profile is required to create a response stream')
    }

    if (!profile.model) {
      throw new Error(`Agent profile ${profile.id} is missing a model`)
    }

    const input = prepareResponseInput(contextState.contextHistory, userInput || '')
    const providerKey = profile.provider || aiState.currentProviderKey || 'openai'

    if (!PROVIDERS[providerKey]) {
      throw new Error(`Unknown provider for response stream: ${providerKey}`)
    }

    logger.debug(
      `StateManager: Creating Responses stream for profile ${profile.id} using provider ${providerKey}`,
    )

    const providerData = await ensureProviderInitialized(providerKey)

    const metadata = normalizeMetadata(profile.metadata)

    const params = {
      model: profile.model,
      input,
      instructions: profile.instructions,
      tools: Array.isArray(profile.tools) ? profile.tools : [],
      ...(metadata ? { metadata } : {}),
      ...responseOptions,
      signal,
    }

    const responseStream = await providerData.instance.createResponseStream(params)

    const emitter = new EventEmitter()
    let aggregatedText = ''
    let aborted = false
    let completed = false
    let finalResponse = null
    let firstDeltaEmitted = false

    const extractTextFromResponse = (response) => {
      if (!response || !response.output) {
        return aggregatedText
      }

      const collected = []

      for (const item of response.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const contentPart of item.content) {
            if (contentPart?.type === 'output_text' && contentPart.text) {
              collected.push(contentPart.text)
            }
          }
        }
      }

      if (collected.length === 0) {
        return aggregatedText
      }

      return collected.join('\n')
    }

    const handleDelta = (event) => {
      const delta = event.delta || ''
      aggregatedText = event.snapshot || (aggregatedText + delta)

      if (!firstDeltaEmitted && delta) {
        firstDeltaEmitted = true
        emitter.emit('first-delta', {
          delta,
          snapshot: event.snapshot,
        })
      }

      if (delta) {
        emitter.emit('delta', {
          delta,
          snapshot: event.snapshot,
        })
      }
    }

    const handleFunctionCallDelta = (event) => {
      emitter.emit('function-call-delta', event)
    }

    const handleCompleted = (event) => {
      completed = true
      const completedText = extractTextFromResponse(event.response)
      aggregatedText = completedText || aggregatedText
      emitter.emit('completed', {
        text: aggregatedText,
        response: event.response,
      })
    }

    const handleFailed = (event) => {
      const error = new Error(event.error?.message || 'Response stream failed')
      emitter.emit('error', error)
    }

    const handleError = (error) => {
      emitter.emit('error', error)
    }

    const handleAbort = (error) => {
      aborted = true
      emitter.emit('aborted', error)
    }

    const handleEnd = () => {
      emitter.emit('end', {
        text: aggregatedText,
        completed,
      })
    }

    responseStream.on('response.output_text.delta', handleDelta)
    responseStream.on('response.function_call_arguments.delta', handleFunctionCallDelta)
    responseStream.on('response.completed', handleCompleted)
    responseStream.on('response.failed', handleFailed)
    responseStream.on('error', handleError)
    responseStream.on('abort', handleAbort)
    responseStream.on('end', handleEnd)

    const removeHandlers = () => {
      responseStream.off('response.output_text.delta', handleDelta)
      responseStream.off(
        'response.function_call_arguments.delta',
        handleFunctionCallDelta,
      )
      responseStream.off('response.completed', handleCompleted)
      responseStream.off('response.failed', handleFailed)
      responseStream.off('error', handleError)
      responseStream.off('abort', handleAbort)
      responseStream.off('end', handleEnd)
    }

    const finalPromise = responseStream
      .finalResponse()
      .then((response) => {
        finalResponse = response
        const finalText = extractTextFromResponse(response)
        aggregatedText = finalText || aggregatedText
        emitter.emit('final', {
          text: aggregatedText,
          response,
        })
        return {
          text: aggregatedText,
          response,
          aborted: false,
        }
      })
      .catch((error) => {
        const isAbort =
          error &&
          (error.name === 'AbortError' || error.name === 'APIUserAbortError')

        if (isAbort) {
          aborted = true
          emitter.emit('aborted', error)
          return {
            text: aggregatedText,
            response: null,
            aborted: true,
          }
        }

        emitter.emit('error', error)
        throw error
      })
      .finally(() => {
        removeHandlers()
      })

    return {
      on: (event, handler) => {
        emitter.on(event, handler)
        return () => emitter.removeListener(event, handler)
      },
      once: (event, handler) => emitter.once(event, handler),
      off: (event, handler) => emitter.removeListener(event, handler),
      waitForCompletion: () => finalPromise,
      abort: () => {
        aborted = true
        responseStream.abort()
      },
      isAborted: () => aborted,
      getSnapshot: () => aggregatedText,
      getFinalResponse: () => finalResponse,
      stream: responseStream,
    }
  }

  function normalizeMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return null
    }

    const normalizedEntries = Object.entries(metadata)
      .filter(([key, value]) => typeof key === 'string' && value !== undefined && value !== null)
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return [key, value]
        }

        try {
          return [key, JSON.stringify(value)]
        } catch {
          return [key, String(value)]
        }
      })

    if (normalizedEntries.length === 0) {
      return null
    }

    return Object.fromEntries(normalizedEntries)
  }

  // Return the functional object (NO CLASS!)
  return {
    // Main operations
    switchProvider,
    switchModel,
    createChatCompletion,
    createResponseStream,

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

    // Agent profiles
    loadAgentProfiles,
    reloadAgentProfiles,
    getAgentProfiles,
    getAgentProfile,
    hasAgentProfile,
    getAgentProfileSummary,
    getAgentProfileStats,
    createAgentProfile,
    updateAgentProfile,
    deleteAgentProfile,

    agentProfiles: {
      loadProfiles: loadAgentProfiles,
      reloadProfiles: reloadAgentProfiles,
      getProfiles: getAgentProfiles,
      getProfile: getAgentProfile,
      hasProfile: hasAgentProfile,
      getProfileSummary: getAgentProfileSummary,
      getStats: getAgentProfileStats,
      createProfile: createAgentProfile,
      updateProfile: updateAgentProfile,
      deleteProfile: deleteAgentProfile,
      listProfiles: getAgentProfiles,
    },


    // Event listeners
    addListener,
    removeListener,

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
