import { color } from '../config/color.js'
import { createInteractiveMenu } from './interactive_menu.js'
import { getDatabase } from './database-manager.js'
import { getCommandRepository } from '../patterns/CommandRepository.js'
import { createSelectionTitle } from './menu-helpers.js'
import { ModelSelector } from './model-selector.js'
import readline from 'node:readline'

export class CommandEditor {
  constructor(aiApplication, rl = null) {
    this.app = aiApplication
    this.rl = rl
    this.modelSelector = new ModelSelector(aiApplication)
  }

  async showCommandMenu() {
    const actions = [
      'Add command',
      'Edit command', 
      'List commands',
      'Delete command'
    ]

    console.log(color.cyan + 'Command Management' + color.reset)
    console.log('')

    const selectedIndex = await createInteractiveMenu('Select action:', actions)
    
    if (selectedIndex === -1) {
      console.log(color.yellow + 'Exiting command menu' + color.reset)
      return
    }

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
    }
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

      console.log(color.cyan + `Editing command "${commandName}"` + color.reset)
      console.log('')

      // Show field selection menu
      const fieldIndex = await this.selectFieldToEdit()
      
      if (fieldIndex === -1) {
        console.log(color.yellow + 'Cancelled' + color.reset)
        return
      }

      let updatedCommand = { ...command }

      switch (fieldIndex) {
        case 0: // Name
          const newName = await this.promptInput(`Name [${command.name}]: `)
          if (newName.trim()) {
            updatedCommand.name = newName.trim()
          }
          break
        case 1: // Command key
          const currentKey = command.key.join(', ')
          const newKey = await this.promptInput(`Command key [${currentKey}]: `)
          if (newKey.trim()) {
            updatedCommand.key = newKey.split(',').map(k => k.trim()).filter(k => k)
          }
          break
        case 2: // Description
          const newDescription = await this.promptInput(`Description [${command.description}]: `)
          if (newDescription.trim()) {
            updatedCommand.description = newDescription.trim()
          }
          break
        case 3: // Instruction
          const newInstruction = await this.promptInput(`Instruction [${command.instruction}]: `)
          if (newInstruction.trim()) {
            updatedCommand.instruction = newInstruction.trim()
          }
          break
        case 4: // Models
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
          break
        case 5: // Cache enabled
          const currentCacheStatus = command.cache_enabled !== undefined ? command.cache_enabled : true
          const cacheOptions = ['Enable cache', 'Disable cache']
          const currentSelection = currentCacheStatus ? 0 : 1
          
          console.log('')
          console.log(color.yellow + `Current cache setting: ${currentCacheStatus ? 'enabled' : 'disabled'}` + color.reset)
          
          const cacheSelectionIndex = await createInteractiveMenu(
            'Select cache setting:',
            cacheOptions
          )
          
          if (cacheSelectionIndex !== -1) {
            const newCacheEnabled = cacheSelectionIndex === 0
            const cacheWasDisabled = currentCacheStatus && !newCacheEnabled
            
            updatedCommand.cache_enabled = newCacheEnabled
            console.log(color.green + `Cache ${updatedCommand.cache_enabled ? 'enabled' : 'disabled'}` + color.reset)
            
            // Clear cache when disabling caching
            if (cacheWasDisabled) {
              try {
                const cache = await import('../utils/cache.js')
                await cache.default.clearCommandCache(commandName)
                console.log(color.grey + '🗑️ Command cache cleared' + color.reset)
              } catch (error) {
                console.log(color.yellow + 'Warning: Could not clear cache: ' + error.message + color.reset)
              }
            }
          }
          break
      }

      await this.saveCommand(commandName, updatedCommand.name, updatedCommand.key, updatedCommand.description, updatedCommand.instruction, updatedCommand.models, updatedCommand.cache_enabled)
      
      console.log(color.green + `Command "${commandName}" updated` + color.reset)
      
      
    } catch (error) {
      console.log(color.red + 'Error editing command: ' + error.message + color.reset)
    }
  }

  async selectFieldToEdit() {
    const fields = [
      'Name',
      'Command key',
      'Description',
      'Instruction',
      'Models',
      'Cache enabled'
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
            const provider = m?.provider || 'unknown'
            const model = m?.model || 'unknown'
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


  async saveCommand(id, name, key, description, instruction, models = null, cache_enabled = true) {
    try {
      // Use CommandRepository for automatic cache invalidation and hot-reload
      const repository = getCommandRepository()
      await repository.save(id, { name, key, description, instruction, models, cache_enabled })
      console.log(color.grey + '🔄 Cache invalidated for hot-reload' + color.reset)
    } catch (error) {
      throw new Error(`Failed to save command: ${error.message}`)
    }
  }

  async removeCommand(name) {
    try {
      // Use CommandRepository for automatic cache invalidation and hot-reload
      const repository = getCommandRepository()
      await repository.delete(name)
      console.log(color.grey + '🔄 Cache invalidated for hot-reload' + color.reset)
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