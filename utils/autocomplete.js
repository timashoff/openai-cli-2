import { getCommandsFromDB } from './database-manager.js'

/**
 * Get all commands from database
 * @returns {string[]} array of all commands
 */
function getAllSystemCommands() {
  const commands = getCommandsFromDB()
  const commandKeys = []
  
  for (const command of Object.values(commands)) {
    if (command.key && Array.isArray(command.key)) {
      commandKeys.push(...command.key)
    }
  }
  
  return commandKeys.sort()
}


export { getAllSystemCommands }
