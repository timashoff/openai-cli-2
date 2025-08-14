/**
 * StateManager - Centralized state management for AI application
 * Manages AI state, context history, operation state, and user session
 */
export class StateManager {
  constructor() {
    // AI provider and model state
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
    
    // Operation state tracking
    this.operationState = {
      isProcessingRequest: false,
      isTypingResponse: false,
      isRetryingProvider: false,
      shouldReturnToPrompt: false
    }
    
    // Request management
    this.requestState = {
      currentRequestController: null,
      currentSpinnerInterval: null,
      currentStreamProcessor: null
    }
    
    // Context and conversation history
    this.contextState = {
      contextHistory: [],
      maxContextHistory: 10 // Default, can be overridden from config
    }
    
    // User session data
    this.userSession = {}
    
    // State change listeners
    this.listeners = new Map()
  }
  
  // === AI State Management ===
  
  /**
   * Update AI provider state
   * @param {Object} providerInfo - Provider information
   */
  updateAIProvider(providerInfo) {
    const previousProvider = this.aiState.selectedProviderKey
    
    this.aiState.provider = providerInfo.instance
    this.aiState.selectedProviderKey = providerInfo.key
    this.aiState.model = providerInfo.model
    this.aiState.models = providerInfo.models || []
    
    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = this.aiState.model
    }
    
    this.notifyListeners('ai-provider-changed', {
      previous: previousProvider,
      current: providerInfo.key,
      model: providerInfo.model
    })
  }
  
  /**
   * Update current model
   * @param {string} modelId - New model ID
   */
  updateModel(modelId) {
    const previousModel = this.aiState.model
    this.aiState.model = modelId
    
    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = modelId
    }
    
    this.notifyListeners('model-changed', {
      previous: previousModel,
      current: modelId
    })
  }
  
  /**
   * Get current AI state
   * @returns {Object} Current AI state
   */
  getAIState() {
    return { ...this.aiState }
  }
  
  // === Operation State Management ===
  
  /**
   * Set processing request state
   * @param {boolean} isProcessing - Whether request is being processed
   * @param {AbortController} controller - Request controller
   */
  setProcessingRequest(isProcessing, controller = null) {
    this.operationState.isProcessingRequest = isProcessing
    this.requestState.currentRequestController = controller
    
    this.notifyListeners('processing-state-changed', {
      isProcessing,
      hasController: !!controller
    })
  }
  
  /**
   * Set typing response state
   * @param {boolean} isTyping - Whether response is being typed
   */
  setTypingResponse(isTyping) {
    this.operationState.isTypingResponse = isTyping
    this.notifyListeners('typing-state-changed', { isTyping })
  }
  
  /**
   * Set provider retry state
   * @param {boolean} isRetrying - Whether provider retry is in progress
   */
  setRetryingProvider(isRetrying) {
    this.operationState.isRetryingProvider = isRetrying
    this.notifyListeners('retry-state-changed', { isRetrying })
  }
  
  /**
   * Get current operation state
   * @returns {Object} Current operation state
   */
  getOperationState() {
    return { ...this.operationState }
  }
  
  // === Request State Management ===
  
  /**
   * Set current stream processor
   * @param {Object} processor - Stream processor instance
   */
  setStreamProcessor(processor) {
    this.requestState.currentStreamProcessor = processor
  }
  
  /**
   * Set spinner interval
   * @param {number} interval - Spinner interval ID
   */
  setSpinnerInterval(interval) {
    this.requestState.currentSpinnerInterval = interval
  }
  
  /**
   * Clear all request state
   */
  clearRequestState() {
    this.requestState.currentRequestController = null
    this.requestState.currentSpinnerInterval = null
    this.requestState.currentStreamProcessor = null
    this.operationState.isProcessingRequest = false
    this.operationState.isTypingResponse = false
  }
  
  /**
   * Get current request controller
   * @returns {AbortController|null} Current request controller
   */
  getCurrentRequestController() {
    return this.requestState.currentRequestController
  }
  
  // === Context Management ===
  
  /**
   * Add message to context history
   * @param {string} role - Message role (user/assistant)
   * @param {string} content - Message content
   */
  addToContext(role, content) {
    this.contextState.contextHistory.push({ role, content })
    
    // Trim history if too long
    if (this.contextState.contextHistory.length > this.contextState.maxContextHistory) {
      this.contextState.contextHistory = this.contextState.contextHistory.slice(-this.contextState.maxContextHistory)
    }
    
    this.notifyListeners('context-updated', {
      role,
      content,
      historyLength: this.contextState.contextHistory.length
    })
  }
  
  /**
   * Clear context history
   */
  clearContext() {
    this.contextState.contextHistory = []
    this.notifyListeners('context-cleared', {})
  }
  
  /**
   * Get context history
   * @returns {Array} Context history array
   */
  getContextHistory() {
    return [...this.contextState.contextHistory]
  }
  
  /**
   * Set maximum context history length
   * @param {number} maxLength - Maximum history length
   */
  setMaxContextHistory(maxLength) {
    this.contextState.maxContextHistory = maxLength
    
    // Trim current history if needed
    if (this.contextState.contextHistory.length > maxLength) {
      this.contextState.contextHistory = this.contextState.contextHistory.slice(-maxLength)
    }
  }
  
  // === User Session Management ===
  
  /**
   * Update user session data
   * @param {Object} sessionData - Session data to merge
   */
  updateUserSession(sessionData) {
    this.userSession = { ...this.userSession, ...sessionData }
    this.notifyListeners('session-updated', sessionData)
  }
  
  /**
   * Get user session data
   * @returns {Object} Current user session
   */
  getUserSession() {
    return { ...this.userSession }
  }
  
  // === Event Listener Management ===
  
  /**
   * Add state change listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  addListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event).add(callback)
  }
  
  /**
   * Remove state change listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  removeListener(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback)
    }
  }
  
  /**
   * Notify listeners of state change
   * @private
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  notifyListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`StateManager listener error for event ${event}:`, error)
        }
      })
    }
  }
  
  // === Utility Methods ===
  
  /**
   * Get complete state snapshot
   * @returns {Object} Complete state snapshot
   */
  getStateSnapshot() {
    return {
      aiState: this.getAIState(),
      operationState: this.getOperationState(),
      contextHistory: this.getContextHistory(),
      userSession: this.getUserSession(),
      timestamp: new Date().toISOString()
    }
  }
  
  /**
   * Reset all state to initial values
   */
  reset() {
    this.aiState = {
      provider: null,
      models: [],
      model: '',
      selectedProviderKey: ''
    }
    
    this.operationState = {
      isProcessingRequest: false,
      isTypingResponse: false,
      isRetryingProvider: false,
      shouldReturnToPrompt: false
    }
    
    this.clearRequestState()
    this.clearContext()
    this.userSession = {}
    
    this.notifyListeners('state-reset', {})
  }
  
  /**
   * Check if application is currently busy
   * @returns {boolean} True if busy
   */
  isBusy() {
    return this.operationState.isProcessingRequest || 
           this.operationState.isTypingResponse || 
           this.operationState.isRetryingProvider
  }
}

/**
 * Create and return a singleton StateManager instance
 */
let stateManagerInstance = null

export function getStateManager() {
  if (!stateManagerInstance) {
    stateManagerInstance = new StateManager()
  }
  return stateManagerInstance
}

export function resetStateManager() {
  if (stateManagerInstance) {
    stateManagerInstance.reset()
  }
  stateManagerInstance = null
}