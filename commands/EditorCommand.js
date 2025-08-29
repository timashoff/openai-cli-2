import { color } from '../config/color.js'
import { createInteractiveMenu } from './interactive_menu.js'
import { databaseCommandService } from '../services/DatabaseCommandService.js'
import { getCommandRepository } from '../patterns/CommandRepository.js'
import { createSelectionTitle } from './menu-helpers.js'
import { ModelSelector } from './model-selector.js'
import { commandHistory } from './CommandHistory.js'
import { emitDatabaseCommandEvent } from '../services/DatabaseCommandService.js'
import readline from 'node:readline'

export class CommandEditor {
  constructor(dependencies = {}) {
    this.app = dependencies.app
    this.rl = dependencies.rl || null
    this.modelSelector = new ModelSelector(dependencies.app)
    this.repository = getCommandRepository()
  }

  async execute(args, context) {
    this.rl = context.rl || this.rl
    return await this.showCommandMenu()
  }

  /**
   * Get cache status with emoji and color
   */
  getCacheStatus(isCached) {
    if (isCached === true) {
      return `${color.green}✓ enabled${color.reset}`
    } else if (isCached === false) {
      return `${color.red}☓ disabled${color.reset}`
    } else {
      return `${color.yellow}⚠️  not set${color.reset}`
    }
  }

  /**
   * Get models preview
   */
  getModelsPreview(models) {
    if (!models || models.length === 0) {
      return `${color.grey}(none)${color.reset}`
    }
    const count = models.length
    const modelNames = models.map(m => {
      if (typeof m === 'string') return m
      return m.model || m.name || 'unknown'
    }).join(', ')

    if (modelNames.length > 40) {
      return `${color.cyan}${modelNames.substring(0, 37)}...${color.reset} ${color.grey}(${count} total)${color.reset}`
    }
    return `${color.cyan}${modelNames}${color.reset} ${color.grey}(${count} total)${color.reset}`
  }

  /**
   * Get text preview (truncated)
   */
  getTextPreview(text, maxLength = 50) {
    if (!text) return `${color.grey}(not set)${color.reset}`
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength - 3) + '...'
  }

  /**
   * Show command header with overview
   */
  showCommandHeader(commandName, command) {
    console.log()
    console.log(`┌─ Command Editor: "${color.cyan}${command.name || commandName}${color.reset}" ─────────────────────────────────┐`)
    console.log(`│                                                                    │`)
    console.log(`│  Keys: ${color.yellow}${command.key ? command.key.join(', ') : 'none'}${color.reset}                    Cache: ${this.getCacheStatus(command.isCached)}     │`)
    console.log(`│  Models: ${this.getModelsPreview(command.models)}`)
    console.log(`│  Description: ${this.getTextPreview(command.description, 45)}                │`)
    console.log(`│  Instruction: ${this.getTextPreview(command.instruction, 45)}                │`)
    console.log(`│                                                                    │`)
    console.log(`└────────────────────────────────────────────────────────────────────┘`)
    console.log()
  }

  /**
   * Show dedicated cache toggle screen with explanation
   */
  async showCacheToggleScreen(command) {
    console.clear()

    // Show current status
    console.log(`┌─ Cache Settings ─────────────────────────────────────────────────┐`)
    console.log(`│                                                                       │`)
    console.log(`│  Current status: ${this.getCacheStatus(command.isCached)}                           │`)
    console.log(`│                                                                       │`)

    if (command.isCached) {
      console.log(`│  When cache is ENABLED:                                               │`)
      console.log(`│  ${color.green}•${color.reset} Responses are saved for faster repeated queries              │`)
      console.log(`│  ${color.green}•${color.reset} Use --force flag to bypass cache when needed                   │`)
      console.log(`│  ${color.green}•${color.reset} Improves performance for translation commands                  │`)
    } else {
      console.log(`│  When cache is DISABLED:                                              │`)
      console.log(`│  ${color.yellow}•${color.reset} Every request will be sent to AI providers                      │`)
      console.log(`│  ${color.yellow}•${color.reset} Responses are not saved                                         │`)
      console.log(`│  ${color.yellow}•${color.reset} Good for dynamic content that changes frequently                │`)
    }

    console.log(`│                                                                       │`)
    console.log(`└───────────────────────────────────────────────────────────────────────┘`)

    const newStatus = !command.isCached
    const toggleOptions = [
      `Toggle to ${newStatus ? '✓ enable' : '✗ disable'}`,
      `Keep ${command.isCached ? '✓ enabled' : '✗ disabled'}}`
    ]

    const choice = await createInteractiveMenu(
      'Choose action:',
      toggleOptions
    )

    if (choice === 0) {
      // Toggle cache
      command.isCached = newStatus

      // Show confirmation with delay
      console.clear()
      console.log(`┌─ Cache Updated ───────────────────────────────────────────────────┐`)
      console.log(`│                                                                       │`)
      console.log(`│           ${newStatus ? '🎉 Cache successfully ENABLED' : 'ℹ️  Cache successfully DISABLED'}              │`)
      console.log(`│                                                                       │`)
      console.log(`│        Command "${command.key ? command.key.join(', ') : 'unknown'}" ${newStatus ? 'will now cache responses' : 'will not cache responses'}          │`)
      console.log(`│                                                                       │`)
      console.log(`│              Returning to menu in 3s...                               │`)
      console.log(`│                                                                       │`)
      console.log(`└───────────────────────────────────────────────────────────────────────┘`)

      // Wait 3 seconds for user to see the confirmation
      await new Promise(resolve => setTimeout(resolve, 3000))
    }

    console.clear()
  }


  async showCommandMenu() {
    const actions = [
      'Add command',
      'Edit command',
      'List commands',
      'Delete command'
    ]

    // Add undo/redo options if available
    const historyStatus = commandHistory.getHistorySummary()
    if (historyStatus.canUndo) {
      actions.push(`Undo: ${historyStatus.nextUndo}`)
    }
    if (historyStatus.canRedo) {
      actions.push(`Redo: ${historyStatus.nextRedo}`)
    }

    console.log(color.cyan + 'Command Management' + color.reset)

    // Show history status
    if (historyStatus.canUndo || historyStatus.canRedo) {
      console.log(color.grey + commandHistory.getStatusMessage() + color.reset)
    }
    console.log('')

    const selectedIndex = await createInteractiveMenu('Select action:', actions)

    if (selectedIndex === -1) {
      console.log(color.yellow + 'Exiting command menu' + color.reset)
      return
    }

    const baseActions = 4 // Add, Edit, List, Delete

    switch (selectedIndex) {
      case 0:
        await this.addCommand()
        break
      case 1:
        await this.editCommand()
        break
      case 2:
        await this.listCommands()
        break
      case 3:
        await this.deleteCommand()
        break
      case baseActions:
        if (historyStatus.canUndo) {
          await this.performUndo()
        }
        break
      case baseActions + 1:
        if (historyStatus.canRedo) {
          await this.performRedo()
        } else if (historyStatus.canUndo && !historyStatus.canRedo) {
          await this.performUndo() // This is actually undo if redo is not available
        }
        break
      case baseActions + (historyStatus.canUndo ? 1 : 0):
        if (historyStatus.canRedo && historyStatus.canUndo) {
          await this.performRedo()
        }
        break
    }

    // Show menu again unless user explicitly exited
    if (selectedIndex !== -1) {
      await this.showCommandMenu()
    }
  }

  /**
   * Undo/Redo functionality
   */
  async performUndo() {
    console.log(color.yellow + 'Performing undo operation...' + color.reset)

    const result = await commandHistory.performUndo({
      repository: this.repository
    })

    if (result.success) {
      console.log(color.green + `✓ Undo successful: ${result.operation}` + color.reset)
    } else {
      console.log(color.red + `✗ Undo failed: ${result.error}` + color.reset)
    }

    // Pause before returning to menu
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  async performRedo() {
    console.log(color.cyan + 'Performing redo operation...' + color.reset)

    const result = await commandHistory.performRedo({
      repository: this.repository
    })

    if (result.success) {
      console.log(color.green + `✓ Redo successful: ${result.operation}` + color.reset)
    } else {
      console.log(color.red + `✗ Redo failed: ${result.error}` + color.reset)
    }

    // Pause before returning to menu
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  /**
   * Undo handlers for specific operations
   */
  async undoAddCommand(context) {
    // Implemented by CommandHistory.executeUndoOperation
    return { success: true, message: 'Add command undone' }
  }

  async undoEditCommand(context) {
    // Implemented by CommandHistory.executeUndoOperation
    return { success: true, message: 'Edit command undone' }
  }

  async undoDeleteCommand(context) {
    // Implemented by CommandHistory.executeUndoOperation
    return { success: true, message: 'Delete command undone' }
  }

  async addCommand() {
    console.log(color.cyan + 'Adding new command' + color.reset)
    console.log('')

    try {
      const key = await this.promptInput('Enter command key (e.g. "aa" or "aa,bb"): ')
      if (!key.trim()) {
        console.log(color.red + 'Command key is required' + color.reset)
        return
      }

      const description = await this.promptInput('Command description (Enter - auto-generate): ')

      const instruction = await this.promptInput('LLM instruction: ')
      if (!instruction.trim()) {
        console.log(color.red + 'Instruction is required' + color.reset)
        return
      }

      const keyArray = key.split(',').map(k => k.trim()).filter(k => k)
      const finalDescription = description.trim() || await this.generateDescription(instruction)

      // Ask about models
      console.log('')
      const addModels = await this.promptInput('Add specific models for this command? (y/n) [n]: ')
      let models = []

      if (addModels.toLowerCase() === 'y' || addModels.toLowerCase() === 'yes') {
        const selectedModels = await this.modelSelector.selectModels([], this.rl)
        if (selectedModels !== null) {
          models = selectedModels
        }
      }

      const commandName = key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
      await this.saveCommand(commandName, commandName, keyArray, finalDescription, instruction, models, true) // Cache enabled by default

      console.log(color.green + `Command "${commandName}" added` + color.reset)


    } catch (error) {
      console.log(color.red + 'Error adding command: ' + error.message + color.reset)
    }
  }

  async editCommand() {
    try {
      const repository = getCommandRepository()
      const commands = await repository.getAllCommands()
      const commandNames = Object.keys(commands)

      if (commandNames.length === 0) {
        console.log(color.yellow + 'No commands to edit' + color.reset)
        return
      }

      const selectedIndex = await createInteractiveMenu(
        createSelectionTitle('command', commandNames.length, 'to edit'),
        commandNames
      )

      if (selectedIndex === -1) {
        console.log(color.yellow + 'Cancelled' + color.reset)
        return
      }

      const commandName = commandNames[selectedIndex]
      const command = commands[commandName]

      // Show informative header with command overview
      this.showCommandHeader(commandName, command)

      // Show enhanced field selection menu with preview
      const fieldIndex = await this.selectFieldToEdit(command)

      if (fieldIndex === -1) {
        console.log(color.yellow + 'Cancelled' + color.reset)
        return
      }

      let updatedCommand = { ...command }

      const editActions = {
        editName: async () => {
          const newName = await this.promptInput(`Name [${command.name}]: `)
          if (newName.trim()) {
            updatedCommand.name = newName.trim()
          }
        },

        editKey: async () => {
          const currentKey = command.key.join(', ')
          const newKey = await this.promptInput(`Command key [${currentKey}]: `)
          if (newKey.trim()) {
            updatedCommand.key = newKey.split(',').map(k => k.trim()).filter(k => k)
          }
        },

        editDescription: async () => {
          const newDescription = await this.promptInput(`Description [${command.description}]: `)
          if (newDescription.trim()) {
            updatedCommand.description = newDescription.trim()
          }
        },

        editInstruction: async () => {
          const newInstruction = await this.promptInput(`Instruction [${command.instruction}]: `)
          if (newInstruction.trim()) {
            updatedCommand.instruction = newInstruction.trim()
          }
        },

        editModels: async () => {
          const currentModels = command.models || []
          console.log('')
          if (currentModels.length > 0) {
            console.log(color.yellow + 'Current models:' + color.reset)
            currentModels.forEach((model, index) => {
              console.log(`  ${index + 1}. ${model.provider} - ${model.model}`)
            })
          } else {
            console.log(color.gray + 'No models configured (will use default)' + color.reset)
          }

          const selectedModels = await this.modelSelector.selectModels(currentModels, this.rl)
          if (selectedModels !== null) {
            updatedCommand.models = selectedModels
          }
        },

        toggleCache: async () => {
          await this.showCacheToggleScreen(updatedCommand)
        }
      }

      const actionNames = ['editName', 'editKey', 'editDescription', 'editInstruction', 'editModels', 'toggleCache']
      const selectedAction = actionNames[fieldIndex]

      if (editActions[selectedAction]) {
        await editActions[selectedAction]()
      }

      await this.saveCommand(commandName, updatedCommand.name, updatedCommand.key, updatedCommand.description, updatedCommand.instruction, updatedCommand.models, updatedCommand.isCached, true)

      console.log(color.green + `Command "${commandName}" updated` + color.reset)


    } catch (error) {
      console.log(color.red + 'Error editing command: ' + error.message + color.reset)
    }
  }

  async selectFieldToEdit(command) {
    // Enhanced field descriptions with preview information
    const fields = [
      `Name: ${color.cyan}"${command.name || 'not set'}"${color.reset}`,
      `Command keys: ${color.yellow}${command.key ? command.key.join(', ') : 'none'}${color.reset}`,
      `Description: ${this.getTextPreview(command.description)}`,
      `Instruction: ${this.getTextPreview(command.instruction)}`,
      `Models: ${this.getModelsPreview(command.models)}`,
      `Cache: ${this.getCacheStatus(command.isCached)}`
    ]

    return await createInteractiveMenu(
      createSelectionTitle('field', fields.length, 'to edit'),
      fields
    )
  }

  async listCommands() {
    try {
      const repository = getCommandRepository()
      const commands = await repository.getAllCommands()

      console.log(color.cyan + 'Commands list:' + color.reset)
      console.log('')

      Object.entries(commands).forEach(([id, cmd]) => {
        // Use cmd.name (human-readable) instead of id (internal key)
        const displayName = cmd.name || id
        console.log(color.green + displayName + color.reset + ':')
        console.log(`  Keys: ${cmd.key.join(', ')}`)
        console.log(`  Description: ${cmd.description}`)
        console.log(`  Instruction: ${cmd.instruction.substring(0, 80)}${cmd.instruction.length > 80 ? '...' : ''}`)

        if (cmd.models && cmd.models.length > 0) {
          const modelList = cmd.models.map(m => {
            // Add null checking for provider and model
            const provider = m ? m.provider || 'unknown' : 'unknown'
            const model = m ? m.model || 'unknown' : 'unknown'
            return `${provider}-${model}`
          }).join(', ')
          console.log(`  Models: ${modelList}`)
        } else {
          console.log(`  Models: ${color.gray}default${color.reset}`)
        }
        console.log('')
      })

      await this.promptInput('Press Enter to continue...')

    } catch (error) {
      console.log(color.red + 'Error listing commands: ' + error.message + color.reset)
    }
  }

  async deleteCommand() {
    try {
      const repository = getCommandRepository()
      const commands = await repository.getAllCommands()
      const commandNames = Object.keys(commands)

      if (commandNames.length === 0) {
        console.log(color.yellow + 'No commands to delete' + color.reset)
        return
      }

      const selectedIndex = await createInteractiveMenu(
        createSelectionTitle('command', commandNames.length, 'to delete'),
        commandNames
      )

      if (selectedIndex === -1) {
        console.log(color.yellow + 'Cancelled' + color.reset)
        return
      }

      const commandName = commandNames[selectedIndex]

      console.log(color.red + `Delete command "${commandName}"?` + color.reset)
      const confirm = await this.promptInput('Type "yes" to confirm: ')

      if (confirm.toLowerCase() !== 'yes') {
        console.log(color.yellow + 'Cancelled' + color.reset)
        return
      }

      await this.removeCommand(commandName)

      console.log(color.green + `Command "${commandName}" deleted` + color.reset)


    } catch (error) {
      console.log(color.red + 'Error deleting command: ' + error.message + color.reset)
    }
  }


  async saveCommand(id, name, key, description, instruction, models = null, isCached = false, isEdit = false) {
    try {
      const repository = getCommandRepository()

      let historyData = null

      if (isEdit) {
        // Get previous values for edit operation
        const existingCommands = await repository.getAllCommands()
        const previousCommand = existingCommands[id]

        if (previousCommand) {
          historyData = {
            id,
            key,
            previousValues: previousCommand,
            newValues: { name, key, description, instruction, models, isCached }
          }
        }
      } else {
        // New command data for add operation
        historyData = {
          id,
          key,
          name,
          description,
          instruction,
          models,
          isCached
        }
      }

      // Save to repository
      await repository.save(id, { name, key, description, instruction, models, isCached })

      // Record in command history
      if (historyData) {
        const operation = isEdit ? 'edit' : 'add'
        commandHistory.recordOperation('command', operation, historyData)
      }

      // Emit database event for hot-reload
      const eventType = isEdit ? 'updated' : 'added'
      emitDatabaseCommandEvent(eventType, { commandId: id, key })

      console.log(color.grey + '🔄 Database event emitted for hot-reload' + color.reset)
    } catch (error) {
      throw new Error(`Failed to save command: ${error.message}`)
    }
  }

  async removeCommand(name) {
    try {
      const repository = getCommandRepository()

      // Get command data before deletion for undo functionality
      const existingCommands = await repository.getAllCommands()
      const commandToDelete = existingCommands[name]

      if (commandToDelete) {
        // Record in history before deletion
        const historyData = {
          id: name,
          key: commandToDelete.key,
          ...commandToDelete
        }
        commandHistory.recordOperation('command', 'delete', historyData)
      }

      // Delete from repository
      await repository.delete(name)

      // Emit database event for hot-reload
      emitDatabaseCommandEvent('deleted', { commandId: name, key: commandToDelete?.key })

      console.log(color.grey + '🔄 Database event emitted for hot-reload' + color.reset)
    } catch (error) {
      throw new Error(`Failed to remove command: ${error.message}`)
    }
  }


  async generateDescription(instruction) {
    try {
      const prompt = `Create a brief description (up to 5 words) for command with instruction: "${instruction}"`

      // Используем текущий провайдер приложения для генерации описания
      const response = await this.app.currentProvider.createChatCompletion([
        { role: 'user', content: prompt }
      ])

      return response.trim()
    } catch (error) {
      console.log(color.yellow + 'Failed to generate description, using default' + color.reset)
      return 'custom command'
    }
  }


  async promptInput(question) {
    if (!this.rl) {
      throw new Error('Readline interface is required for CommandEditor')
    }
    return await this.rl.question(question)
  }
}
