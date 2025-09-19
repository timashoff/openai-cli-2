import { EventEmitter } from 'node:events'
import { logger } from '../../utils/logger.js'

export const createMultiModelCoordinator = () => {
  const eventBus = new EventEmitter()

  const coordinatorState = {
    models: new Map(),
    winnerModel: null,
    completedModels: new Set(),
    pendingResults: [],
    isWinnerStreaming: false
  }

  const resetState = () => {
    coordinatorState.models.clear()
    coordinatorState.completedModels.clear()
    coordinatorState.pendingResults = []
    coordinatorState.winnerModel = null
    coordinatorState.isWinnerStreaming = false
    logger.debug('Coordinator: State reset')
  }

  const registerModel = (model, promise) => {
    const modelKey = getModelKey(model)
    coordinatorState.models.set(modelKey, { model, promise })
    logger.debug(`Coordinator: Registered model ${modelKey}`)
  }

  const setWinner = (model) => {
    if (coordinatorState.winnerModel) return false

    coordinatorState.winnerModel = model
    coordinatorState.isWinnerStreaming = true

    logger.debug(`Coordinator: Winner selected - ${getModelKey(model)}`)
    eventBus.emit('winner:selected', { model })

    return true
  }

  const completeModel = (model, result) => {
    const modelKey = getModelKey(model)
    coordinatorState.completedModels.add(modelKey)

    logger.debug(`Coordinator: Model completed - ${modelKey}`)

    const isWinner = model === coordinatorState.winnerModel

    if (isWinner) {
      coordinatorState.isWinnerStreaming = false
      eventBus.emit('winner:completed', { model, result })

      // Flush pending results in chronological order
      const sortedPending = coordinatorState.pendingResults
        .sort((a, b) => a.timestamp - b.timestamp)

      sortedPending.forEach(item => {
        eventBus.emit('model:display-result', { result: item.result })
      })

      coordinatorState.pendingResults = []
    } else {
      if (coordinatorState.isWinnerStreaming) {
        // Queue result for later display
        coordinatorState.pendingResults.push({
          result,
          timestamp: Date.now()
        })
        logger.debug(`Coordinator: Queued result for ${modelKey}`)
      } else {
        // Winner already finished, display immediately
        eventBus.emit('model:display-result', { result })
      }
    }

    eventBus.emit('model:completed', { model, result, isWinner })

    // Emit remaining count change for reactive UI
    const remainingCount = getRemainingCount()
    eventBus.emit('remaining-count:changed', { remainingCount })

    // Check if all models completed
    if (isAllCompleted()) {
      eventBus.emit('all:completed', {
        totalModels: coordinatorState.models.size,
        successfulModels: getSuccessfulCount()
      })
    }
  }

  const getModelKey = (model) => `${model.provider}:${model.model}`

  const getRemainingCount = () => {
    return coordinatorState.models.size - coordinatorState.completedModels.size
  }

  const getCompletedCount = () => {
    return coordinatorState.completedModels.size
  }

  const getSuccessfulCount = () => {
    return Array.from(coordinatorState.models.values())
      .filter(({ model }) => {
        const modelKey = getModelKey(model)
        return coordinatorState.completedModels.has(modelKey)
      }).length
  }

  const isAllCompleted = () => {
    return coordinatorState.models.size === coordinatorState.completedModels.size
  }

  // Event handler helpers
  const onWinnerSelected = (handler) => eventBus.on('winner:selected', handler)
  const onWinnerCompleted = (handler) => eventBus.on('winner:completed', handler)
  const onModelCompleted = (handler) => eventBus.on('model:completed', handler)
  const onDisplayResult = (handler) => eventBus.on('model:display-result', handler)
  const onRemainingCountChanged = (handler) => eventBus.on('remaining-count:changed', handler)
  const onAllCompleted = (handler) => eventBus.on('all:completed', handler)

  return {
    // Core functionality
    eventBus,
    resetState,
    registerModel,
    setWinner,
    completeModel,
    getModelKey,

    // State queries
    getRemainingCount,
    getCompletedCount,
    getSuccessfulCount,
    isAllCompleted,

    // Event handlers
    onWinnerSelected,
    onWinnerCompleted,
    onModelCompleted,
    onDisplayResult,
    onRemainingCountChanged,
    onAllCompleted,

    // State getters
    get winnerModel() { return coordinatorState.winnerModel },
    get isWinnerStreaming() { return coordinatorState.isWinnerStreaming },
    get totalModels() { return coordinatorState.models.size }
  }
}