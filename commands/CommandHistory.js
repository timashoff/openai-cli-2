/**
 * CommandHistory - Undo/Redo system for command operations
 * 
 * Implements stack-based history with memento pattern for:
 * - Database command operations (add, edit, delete)
 * - Command state preservation and restoration
 * - Configurable undo stack limits
 * 
 * Part of Phase 3.7: Modern Command Pattern completion
 */

import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'

/**
 * Command Memento - stores command state for undo operations
 */
export class CommandMemento {
  constructor(commandName, operation, data, timestamp = new Date()) {
    this.commandName = commandName
    this.operation = operation    // 'add', 'edit', 'delete'
    this.data = data             // Command data snapshot
    this.timestamp = timestamp
    this.id = this.generateId()
  }

  generateId() {
    return `${this.commandName}_${this.operation}_${this.timestamp.getTime()}`
  }

  /**
   * Get description of this memento for UI display

   */
  getDescription() {
    switch (this.operation) {
      case 'add':
        return `Added command "${this.data.key || this.data.name}"`
      case 'edit':
        return `Edited command "${this.data.key || this.data.name}"`
      case 'delete':
        return `Deleted command "${this.data.key || this.data.name}"`
      default:
        return `${this.operation} operation on ${this.commandName}`
    }
  }

  /**
   * Create inverse operation memento for redo functionality

   */
  getInverseOperation() {
    switch (this.operation) {
      case 'add':
        return {
          operation: 'delete',
          data: { id: this.data.id, key: this.data.key }
        }
      case 'delete':
        return {
          operation: 'add',
          data: this.data
        }
      case 'edit':
        return {
          operation: 'edit',
          data: this.data.newValues,
          previousData: this.data.previousValues
        }
      default:
        return null
    }
  }
}

/**
 * CommandHistory - Main undo/redo management system
 */
export class CommandHistory {
  constructor(options = {}) {
    this.maxUndoSteps = options.maxUndoSteps || 10
    this.maxRedoSteps = options.maxRedoSteps || 10
    
    // History stacks
    this.undoStack = []
    this.redoStack = []
    
    // State tracking
    this.currentIndex = -1
    this.totalOperations = 0
    this.sessionStart = new Date()
    
    // Statistics
    this.stats = {
      undoCount: 0,
      redoCount: 0,
      operationsCount: 0,
      lastOperation: null
    }
    
    logger.debug(`CommandHistory: Initialized with undo limit: ${this.maxUndoSteps}`)
  }

  /**
   * Record a command operation for potential undo




   */
  recordOperation(commandName, operation, data, options = {}) {
    try {
      const memento = new CommandMemento(commandName, operation, data)
      
      // Add to undo stack
      this.undoStack.push(memento)
      
      // Limit undo stack size
      if (this.undoStack.length > this.maxUndoSteps) {
        this.undoStack.shift()
      }
      
      // Clear redo stack when new operation is recorded
      this.redoStack = []
      
      // Update statistics
      this.stats.operationsCount++
      this.stats.lastOperation = {
        memento: memento,
        timestamp: new Date()
      }
      
      this.totalOperations++
      this.currentIndex = this.undoStack.length - 1
      
      logger.debug(`CommandHistory: Recorded ${operation} operation for ${commandName}`)
      
      return memento.id
      
    } catch (error) {
      logger.error('CommandHistory: Error recording operation:', error)
      return null
    }
  }

  /**
   * Check if undo is available

   */
  canUndo() {
    return this.undoStack.length > 0
  }

  /**
   * Check if redo is available  

   */
  canRedo() {
    return this.redoStack.length > 0
  }

  /**
   * Get the next operation that would be undone

   */
  peekUndo() {
    if (!this.canUndo()) return null
    return this.undoStack[this.undoStack.length - 1]
  }

  /**
   * Get the next operation that would be redone

   */
  peekRedo() {
    if (!this.canRedo()) return null
    return this.redoStack[this.redoStack.length - 1]
  }

  /**
   * Perform undo operation


   */
  async performUndo(context = {}) {
    if (!this.canUndo()) {
      return {
        success: false,
        error: 'No operations to undo',
        canUndo: false,
        canRedo: this.canRedo()
      }
    }

    try {
      const memento = this.undoStack.pop()
      const undoResult = await this.executeUndoOperation(memento, context)
      
      if (undoResult.success) {
        // Move to redo stack
        this.redoStack.push(memento)
        
        // Limit redo stack size
        if (this.redoStack.length > this.maxRedoSteps) {
          this.redoStack.shift()
        }
        
        // Update statistics
        this.stats.undoCount++
        this.currentIndex--
        
        logger.info(`CommandHistory: Undo successful - ${memento.getDescription()}`)
        
        return {
          success: true,
          operation: memento.getDescription(),
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
          memento: memento
        }
      } else {
        // Restore memento to undo stack on failure
        this.undoStack.push(memento)
        return undoResult
      }
      
    } catch (error) {
      logger.error('CommandHistory: Undo operation failed:', error)
      
      return {
        success: false,
        error: error.message,
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
      }
    }
  }

  /**
   * Perform redo operation


   */
  async performRedo(context = {}) {
    if (!this.canRedo()) {
      return {
        success: false,
        error: 'No operations to redo',
        canUndo: this.canUndo(),
        canRedo: false
      }
    }

    try {
      const memento = this.redoStack.pop()
      const redoResult = await this.executeRedoOperation(memento, context)
      
      if (redoResult.success) {
        // Move back to undo stack
        this.undoStack.push(memento)
        
        // Update statistics
        this.stats.redoCount++
        this.currentIndex++
        
        logger.info(`CommandHistory: Redo successful - ${memento.getDescription()}`)
        
        return {
          success: true,
          operation: memento.getDescription(),
          canUndo: this.canUndo(),
          canRedo: this.canRedo(),
          memento: memento
        }
      } else {
        // Restore memento to redo stack on failure
        this.redoStack.push(memento)
        return redoResult
      }
      
    } catch (error) {
      logger.error('CommandHistory: Redo operation failed:', error)
      
      return {
        success: false,
        error: error.message,
        canUndo: this.canUndo(),
        canRedo: this.canRedo()
      }
    }
  }

  /**
   * Execute undo operation based on memento



   */
  async executeUndoOperation(memento, context) {
    const { repository } = context
    
    if (!repository) {
      return {
        success: false,
        error: 'Repository not available for undo operation'
      }
    }

    try {
      switch (memento.operation) {
        case 'add':
          // Undo add by deleting the added command
          await repository.deleteCommand(memento.data.id)
          return {
            success: true,
            message: `Removed command "${memento.data.key}"`
          }
          
        case 'delete':
          // Undo delete by re-adding the command
          await repository.createCommand(memento.data)
          return {
            success: true,
            message: `Restored command "${memento.data.key}"`
          }
          
        case 'edit':
          // Undo edit by restoring previous values
          await repository.updateCommand(memento.data.id, memento.data.previousValues)
          return {
            success: true,
            message: `Reverted changes to command "${memento.data.key}"`
          }
          
        default:
          return {
            success: false,
            error: `Unknown operation type: ${memento.operation}`
          }
      }
    } catch (error) {
      return {
        success: false,
        error: `Undo failed: ${error.message}`
      }
    }
  }

  /**
   * Execute redo operation (re-apply the original operation)



   */
  async executeRedoOperation(memento, context) {
    const { repository } = context
    
    if (!repository) {
      return {
        success: false,
        error: 'Repository not available for redo operation'
      }
    }

    try {
      switch (memento.operation) {
        case 'add':
          // Redo add by re-adding the command
          await repository.createCommand(memento.data)
          return {
            success: true,
            message: `Re-added command "${memento.data.key}"`
          }
          
        case 'delete':
          // Redo delete by deleting again
          await repository.deleteCommand(memento.data.id)
          return {
            success: true,
            message: `Re-deleted command "${memento.data.key}"`
          }
          
        case 'edit':
          // Redo edit by applying new values again
          await repository.updateCommand(memento.data.id, memento.data.newValues)
          return {
            success: true,
            message: `Re-applied changes to command "${memento.data.key}"`
          }
          
        default:
          return {
            success: false,
            error: `Unknown operation type: ${memento.operation}`
          }
      }
    } catch (error) {
      return {
        success: false,
        error: `Redo failed: ${error.message}`
      }
    }
  }

  /**
   * Clear all history
   */
  clear() {
    this.undoStack = []
    this.redoStack = []
    this.currentIndex = -1
    this.stats.undoCount = 0
    this.stats.redoCount = 0
    this.stats.lastOperation = null
    
    logger.debug('CommandHistory: History cleared')
  }

  /**
   * Get history summary for UI display

   */
  getHistorySummary() {
    const recentUndo = this.undoStack.slice(-3).reverse().map(m => m.getDescription())
    const recentRedo = this.redoStack.slice(-3).reverse().map(m => m.getDescription())
    
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      recentUndo,
      recentRedo,
      nextUndo: this.peekUndo()?.getDescription() || null,
      nextRedo: this.peekRedo()?.getDescription() || null
    }
  }

  /**
   * Get detailed statistics

   */
  getStats() {
    const sessionDuration = Date.now() - this.sessionStart.getTime()
    
    return {
      ...this.stats,
      totalOperations: this.totalOperations,
      undoStackSize: this.undoStack.length,
      redoStackSize: this.redoStack.length,
      maxUndoSteps: this.maxUndoSteps,
      maxRedoSteps: this.maxRedoSteps,
      sessionDuration: sessionDuration,
      averageOperationTime: this.totalOperations > 0 ? sessionDuration / this.totalOperations : 0
    }
  }

  /**
   * Generate status message for UI

   */
  getStatusMessage() {
    if (!this.canUndo() && !this.canRedo()) {
      return `${color.grey}No operations to undo/redo${color.reset}`
    }
    
    let status = []
    
    if (this.canUndo()) {
      const next = this.peekUndo().getDescription()
      status.push(`${color.yellow}Undo:${color.reset} ${next}`)
    }
    
    if (this.canRedo()) {
      const next = this.peekRedo().getDescription()
      status.push(`${color.cyan}Redo:${color.reset} ${next}`)
    }
    
    return status.join(' | ')
  }
}

/**
 * Export singleton instance for global usage
 */
export const commandHistory = new CommandHistory()

/**
 * Convenience functions for common operations
 */
export function recordCommand(commandName, operation, data) {
  return commandHistory.recordOperation(commandName, operation, data)
}

export function undoLastCommand(context) {
  return commandHistory.performUndo(context)
}

export function redoLastCommand(context) {
  return commandHistory.performRedo(context)
}

export function canUndoCommand() {
  return commandHistory.canUndo()
}

export function canRedoCommand() {
  return commandHistory.canRedo()
}

export function getCommandHistoryStatus() {
  return commandHistory.getStatusMessage()
}