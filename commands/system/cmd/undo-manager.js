import { logger } from '../../../utils/logger.js'
import { ANSI } from '../../../config/ansi.js'

/**
 * Create command memento - stores command state for undo operations
 */
export function createCommandMemento(
  commandName,
  operation,
  data,
  timestamp = new Date(),
) {
  const memento = {
    commandName,
    operation, // 'add', 'edit', 'delete'
    data, // Command data snapshot
    timestamp,
    id: `${commandName}_${operation}_${timestamp.getTime()}`,
  }

  return {
    ...memento,

    /**
     * Get description of this memento for UI display
     */
    getDescription() {
      switch (operation) {
        case 'add':
          return `Added command "${data.key || data.name}"`
        case 'edit':
          return `Edited command "${data.key || data.name}"`
        case 'delete':
          return `Deleted command "${data.key || data.name}"`
        default:
          return `${operation} operation on ${commandName}`
      }
    },

    /**
     * Create inverse operation memento for redo functionality
     */
    getInverseOperation() {
      switch (operation) {
        case 'add':
          return {
            operation: 'delete',
            data: { id: data.id, key: data.key },
          }
        case 'delete':
          return {
            operation: 'add',
            data: data,
          }
        case 'edit':
          return {
            operation: 'edit',
            data: data.newValues,
            previousData: data.previousValues,
          }
        default:
          return null
      }
    },
  }
}

/**
 * Create undo/redo management system - functional factory
 */
export function createUndoManager(options = {}) {
  const maxUndoSteps = options.maxUndoSteps || 10
  const maxRedoSteps = options.maxRedoSteps || 10

  // History stacks
  let undoStack = []
  let redoStack = []

  // State tracking
  let currentIndex = -1
  let totalOperations = 0
  const sessionStart = new Date()

  // Statistics
  const stats = {
    undoCount: 0,
    redoCount: 0,
    operationsCount: 0,
    lastOperation: null,
  }

  logger.debug(`UndoManager: Initialized with undo limit: ${maxUndoSteps}`)

  return {
    /**
     * Record a command operation for potential undo
     */
    recordOperation(commandName, operation, data, options = {}) {
      try {
        const memento = createCommandMemento(commandName, operation, data)

        // Add to undo stack
        undoStack.push(memento)

        // Limit undo stack size
        if (undoStack.length > maxUndoSteps) {
          undoStack.shift()
        }

        // Clear redo stack when new operation is recorded
        redoStack = []

        // Update statistics
        stats.operationsCount++
        stats.lastOperation = {
          memento: memento,
          timestamp: new Date(),
        }

        totalOperations++
        currentIndex = undoStack.length - 1

        logger.debug(
          `UndoManager: Recorded ${operation} operation for ${commandName}`,
        )

        return memento.id
      } catch (error) {
        logger.error('UndoManager: Error recording operation:', error)
        return null
      }
    },

    /**
     * Check if undo is available
     */
    canUndo() {
      return undoStack.length > 0
    },

    /**
     * Check if redo is available
     */
    canRedo() {
      return redoStack.length > 0
    },

    /**
     * Get the next operation that would be undone
     */
    peekUndo() {
      if (!this.canUndo()) return null
      return undoStack[undoStack.length - 1]
    },

    /**
     * Get the next operation that would be redone
     */
    peekRedo() {
      if (!this.canRedo()) return null
      return redoStack[redoStack.length - 1]
    },

    /**
     * Perform undo operation
     */
    async performUndo(context = {}) {
      if (!this.canUndo()) {
        return {
          success: false,
          error: 'No operations to undo',
          canUndo: false,
          canRedo: this.canRedo(),
        }
      }

      try {
        const memento = undoStack.pop()
        const undoResult = await this.executeUndoOperation(memento, context)

        if (undoResult.success) {
          // Move to redo stack
          redoStack.push(memento)

          // Limit redo stack size
          if (redoStack.length > maxRedoSteps) {
            redoStack.shift()
          }

          // Update statistics
          stats.undoCount++
          currentIndex--

          logger.info(
            `UndoManager: Undo successful - ${memento.getDescription()}`,
          )

          return {
            success: true,
            operation: memento.getDescription(),
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            memento: memento,
          }
        } else {
          // Restore memento to undo stack on failure
          undoStack.push(memento)
          return undoResult
        }
      } catch (error) {
        logger.error('UndoManager: Undo operation failed:', error)

        return {
          success: false,
          error: error.message,
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
        }
      }
    },

    /**
     * Perform redo operation
     */
    async performRedo(context = {}) {
      if (!this.canRedo()) {
        return {
          success: false,
          error: 'No operations to redo',
          canUndo: this.canUndo(),
          canRedo: false,
        }
      }

      try {
        const memento = redoStack.pop()
        const redoResult = await this.executeRedoOperation(memento, context)

        if (redoResult.success) {
          // Move back to undo stack
          undoStack.push(memento)

          // Update statistics
          stats.redoCount++
          currentIndex++

          logger.info(
            `UndoManager: Redo successful - ${memento.getDescription()}`,
          )

          return {
            success: true,
            operation: memento.getDescription(),
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            memento: memento,
          }
        } else {
          // Restore memento to redo stack on failure
          redoStack.push(memento)
          return redoResult
        }
      } catch (error) {
        logger.error('UndoManager: Redo operation failed:', error)

        return {
          success: false,
          error: error.message,
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
        }
      }
    },

    /**
     * Execute undo operation based on memento
     */
    async executeUndoOperation(memento, context) {
      const { repository } = context

      if (!repository) {
        return {
          success: false,
          error: 'Repository not available for undo operation',
        }
      }

      try {
        switch (memento.operation) {
          case 'add':
            // Undo add by deleting the added command
            await repository.deleteCommand(memento.data.id)
            return {
              success: true,
              message: `Removed command "${memento.data.key}"`,
            }

          case 'delete':
            // Undo delete by re-adding the command
            await repository.createCommand(memento.data)
            return {
              success: true,
              message: `Restored command "${memento.data.key}"`,
            }

          case 'edit':
            // Undo edit by restoring previous values
            await repository.updateCommand(
              memento.data.id,
              memento.data.previousValues,
            )
            return {
              success: true,
              message: `Reverted changes to command "${memento.data.key}"`,
            }

          default:
            return {
              success: false,
              error: `Unknown operation type: ${memento.operation}`,
            }
        }
      } catch (error) {
        return {
          success: false,
          error: `Undo failed: ${error.message}`,
        }
      }
    },

    /**
     * Execute redo operation (re-apply the original operation)
     */
    async executeRedoOperation(memento, context) {
      const { repository } = context

      if (!repository) {
        return {
          success: false,
          error: 'Repository not available for redo operation',
        }
      }

      try {
        switch (memento.operation) {
          case 'add':
            // Redo add by re-adding the command
            await repository.createCommand(memento.data)
            return {
              success: true,
              message: `Re-added command "${memento.data.key}"`,
            }

          case 'delete':
            // Redo delete by deleting again
            await repository.deleteCommand(memento.data.id)
            return {
              success: true,
              message: `Re-deleted command "${memento.data.key}"`,
            }

          case 'edit':
            // Redo edit by applying new values again
            await repository.updateCommand(
              memento.data.id,
              memento.data.newValues,
            )
            return {
              success: true,
              message: `Re-applied changes to command "${memento.data.key}"`,
            }

          default:
            return {
              success: false,
              error: `Unknown operation type: ${memento.operation}`,
            }
        }
      } catch (error) {
        return {
          success: false,
          error: `Redo failed: ${error.message}`,
        }
      }
    },

    /**
     * Clear all history
     */
    clear() {
      undoStack = []
      redoStack = []
      currentIndex = -1
      stats.undoCount = 0
      stats.redoCount = 0
      stats.lastOperation = null

      logger.debug('UndoManager: History cleared')
    },

    /**
     * Get history summary for UI display
     */
    getHistorySummary() {
      const recentUndo = undoStack
        .slice(-3)
        .reverse()
        .map((m) => m.getDescription())
      const recentRedo = redoStack
        .slice(-3)
        .reverse()
        .map((m) => m.getDescription())

      return {
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        undoCount: undoStack.length,
        redoCount: redoStack.length,
        recentUndo,
        recentRedo,
        nextUndo: this.peekUndo()?.getDescription() || null,
        nextRedo: this.peekRedo()?.getDescription() || null,
      }
    },

    /**
     * Get detailed statistics
     */
    getStats() {
      const sessionDuration = Date.now() - sessionStart.getTime()

      return {
        ...stats,
        totalOperations: totalOperations,
        undoStackSize: undoStack.length,
        redoStackSize: redoStack.length,
        maxUndoSteps: maxUndoSteps,
        maxRedoSteps: maxRedoSteps,
        sessionDuration: sessionDuration,
        averageOperationTime:
          totalOperations > 0 ? sessionDuration / totalOperations : 0,
      }
    },

    /**
     * Generate status message for UI
     */
    getStatusMessage() {
      if (!this.canUndo() && !this.canRedo()) {
        return `${ANSI.COLORS.GREY}No operations to undo/redo${ANSI.COLORS.RESET}`
      }

      let status = []

      if (this.canUndo()) {
        const next = this.peekUndo().getDescription()
        status.push(`${ANSI.COLORS.YELLOW}Undo:${ANSI.COLORS.RESET} ${next}`)
      }

      if (this.canRedo()) {
        const next = this.peekRedo().getDescription()
        status.push(`${ANSI.COLORS.CYAN}Redo:${ANSI.COLORS.RESET} ${next}`)
      }

      return status.join(' | ')
    },
  }
}

/**
 * Create singleton instance for global usage
 */
let globalUndoManagerInstance = null

export function getUndoManager() {
  if (!globalUndoManagerInstance) {
    globalUndoManagerInstance = createUndoManager()
  }
  return globalUndoManagerInstance
}

/**
 * Convenience functions for common operations
 */
export function recordCommand(commandName, operation, data) {
  return getUndoManager().recordOperation(commandName, operation, data)
}

export function undoLastCommand(context) {
  return getUndoManager().performUndo(context)
}

export function redoLastCommand(context) {
  return getUndoManager().performRedo(context)
}

export function canUndoCommand() {
  return getUndoManager().canUndo()
}

export function canRedoCommand() {
  return getUndoManager().canRedo()
}

export function getCommandHistoryStatus() {
  return getUndoManager().getStatusMessage()
}
