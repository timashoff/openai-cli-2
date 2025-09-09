import { databaseCommandService } from '../services/DatabaseCommandService.js'
import { getAllSystemCommandNames } from './system-commands.js'

/**
 * Get all commands: system commands + user commands from database
 * Follows Single Source of Truth principle
 */
function getAllSystemCommands() {
  // 1. System commands from config (help, model, provider, exit, cmd + aliases)
  const systemCommands = getAllSystemCommandNames()
  
  // 2. User commands from database (aa, rr, gg, etc.)
  const userCommands = databaseCommandService.getCommands()
  const userCommandKeys = []
  
  for (const command of Object.values(userCommands)) {
    if (command.key && Array.isArray(command.key)) {
      userCommandKeys.push(...command.key)
    }
  }
  
  // 3. Combine both (no duplicates because system commands removed from DB)
  return [...systemCommands, ...userCommandKeys].sort()
}


export { getAllSystemCommands }
