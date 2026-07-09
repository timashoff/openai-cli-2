import { commandService } from '../../../services/commands/index.js'
import { getAllSystemCommandNames } from '../../../utils/system-commands.js'

export function getAllAvailableCommands() {
  const systemCommands = getAllSystemCommandNames()
  const userCommandKeys = commandService.getAllKeys()
  return [...systemCommands, ...userCommandKeys].sort()
}
