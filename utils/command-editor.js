import { color } from '../config/color.js'
import { createInteractiveMenu } from './interactive_menu.js'
import { getDatabase } from './database-manager.js'
import { createSelectionTitle } from './menu-helpers.js'
import readline from 'node:readline'

export class CommandEditor {
  constructor(aiApplication) {
    this.app = aiApplication
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

      const commandName = key.toUpperCase().replace(/[^A-Z0-9]/g, '_')
      await this.saveCommand(commandName, keyArray, finalDescription, instruction)
      
      console.log(color.green + `Command "${commandName}" added` + color.reset)
      
      
    } catch (error) {
      console.log(color.red + 'Error adding command: ' + error.message + color.reset)
    }
  }

  async editCommand() {
    try {
      const commands = await this.loadCommands()
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

      const currentKey = command.key.join(', ')
      const newKey = await this.promptInput(`Command key [${currentKey}]: `)
      const newDescription = await this.promptInput(`Description [${command.description}]: `)
      const newInstruction = await this.promptInput(`Instruction [${command.instruction}]: `)

      const finalKey = newKey.trim() ? newKey.split(',').map(k => k.trim()).filter(k => k) : command.key
      const finalDescription = newDescription.trim() || command.description
      const finalInstruction = newInstruction.trim() || command.instruction

      await this.saveCommand(commandName, finalKey, finalDescription, finalInstruction)
      
      console.log(color.green + `Command "${commandName}" updated` + color.reset)
      
      
    } catch (error) {
      console.log(color.red + 'Error editing command: ' + error.message + color.reset)
    }
  }

  async listCommands() {
    try {
      const commands = await this.loadCommands()
      
      console.log(color.cyan + 'Commands list:' + color.reset)
      console.log('')
      
      Object.entries(commands).forEach(([name, cmd]) => {
        console.log(color.green + name + color.reset + ':')
        console.log(`  Keys: ${cmd.key.join(', ')}`)
        console.log(`  Description: ${cmd.description}`)
        console.log(`  Instruction: ${cmd.instruction.substring(0, 80)}${cmd.instruction.length > 80 ? '...' : ''}`)
        console.log('')
      })
      
      await this.promptInput('Press Enter to continue...')
      
    } catch (error) {
      console.log(color.red + 'Error listing commands: ' + error.message + color.reset)
    }
  }

  async deleteCommand() {
    try {
      const commands = await this.loadCommands()
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

  async loadCommands() {
    try {
      const db = getDatabase()
      return db.getAllCommands()
    } catch (error) {
      throw new Error(`Failed to load commands: ${error.message}`)
    }
  }

  async saveCommand(name, key, description, instruction) {
    try {
      const db = getDatabase()
      db.saveCommand(name, key, description, instruction)
    } catch (error) {
      throw new Error(`Failed to save command: ${error.message}`)
    }
  }

  async removeCommand(name) {
    try {
      const db = getDatabase()
      db.deleteCommand(name)
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
    const { rl } = await import('./index.js')
    return await rl.question(question)
  }
}