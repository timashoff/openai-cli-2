/**
 * cmd/index.js - Main export for CMD command module
 * Integrates command operations with undo/redo system
 */

import { BaseCmdCommand } from './cmd-operations.js'
import { createUndoManager } from './undo-manager.js'

/**
 * Helper function to create integrated command with undo support
 */
function createCmdWithUndo(cmdCommand, undoManager) {
  return {
    async execute(args, context) {
      // Add undo manager to context for command operations
      const enhancedContext = {
        ...context,
        undo: undoManager
      }

      return await cmdCommand.execute(args, enhancedContext)
    },


    // Expose undo manager methods for external access
    canUndo() {
      return undoManager.canUndo()
    },

    canRedo() {
      return undoManager.canRedo()
    },

    async performUndo(context) {
      return await undoManager.performUndo(context)
    },

    async performRedo(context) {
      return await undoManager.performRedo(context)
    },

    getUndoStatus() {
      return undoManager.getStatusMessage()
    },

    recordOperation(commandName, operation, data) {
      return undoManager.recordOperation(commandName, operation, data)
    }
  }
}

/**
 * Main export - single unified CMD module
 */
export const CmdModule = createCmdWithUndo(BaseCmdCommand, createUndoManager())
