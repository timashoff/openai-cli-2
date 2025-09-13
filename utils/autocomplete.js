import { databaseCommandService } from '../services/database-command-service.js'
import { getAllSystemCommandNames } from './system-commands.js'

export function getAllAvailableCommands() {
  const systemCommands = getAllSystemCommandNames()
  const userCommands = databaseCommandService.getCommands()
  const userCommandKeys = Object.values(userCommands)
    .filter((command) => command.key && Array.isArray(command.key))
    .flatMap((command) => command.key)
  return [...systemCommands, ...userCommandKeys].sort()
}
