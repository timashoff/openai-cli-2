// System Commands Utilities - Business Logic for System Commands
// Contains helper functions for working with system commands configuration
// Separated from config/system-commands.js following Single Responsibility Principle

import { SYSTEM_COMMANDS } from '../config/system-commands.js'

export function isSystemCommand(commandName) {
  const lowerName = commandName.toLowerCase()
  
  // Check main command names
  if (SYSTEM_COMMANDS[lowerName]) {
    return true
  }
  
  // Check aliases
  for (const [mainCommand, config] of Object.entries(SYSTEM_COMMANDS)) {
    if (config.aliases && config.aliases.includes(lowerName)) {
      return true
    }
  }
  
  return false
}

export function getSystemCommand(commandName) {
  const lowerName = commandName.toLowerCase()
  
  // Check main command names
  if (SYSTEM_COMMANDS[lowerName]) {
    return {
      name: lowerName,
      ...SYSTEM_COMMANDS[lowerName]
    }
  }
  
  // Check aliases
  for (const [mainCommand, config] of Object.entries(SYSTEM_COMMANDS)) {
    if (config.aliases && config.aliases.includes(lowerName)) {
      return {
        name: mainCommand,
        ...config
      }
    }
  }
  
  return null
}

export function getAllSystemCommandNames() {
  const names = []
  
  for (const [command, config] of Object.entries(SYSTEM_COMMANDS)) {
    names.push(command)
    if (config.aliases) {
      names.push(...config.aliases)
    }
  }
  
  return names
}