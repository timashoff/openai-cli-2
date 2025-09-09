/**
 * System Commands Configuration - Single Source of Truth
 * Defines all system commands, their aliases, handlers, and metadata
 * Used by both Router.js and SystemCommandHandler.js
 */

export const SYSTEM_COMMANDS = {
  help: {
    aliases: ['h', '?'],
    handler: 'HelpCommand',
    module: '../commands/help-command.js',
    description: 'Show all commands and usage information',
    usage: 'help'
  },
  
  provider: {
    aliases: ['p'],
    handler: 'ProviderCommand',
    module: '../commands/provider-command.js',
    description: 'Open provider selection menu',
    usage: 'provider'
  },
  
  model: {
    aliases: ['m'],
    handler: 'ModelCommand',
    module: '../commands/model-command.js',
    description: 'Open model selection menu',
    usage: 'model'
  },
  
  exit: {
    aliases: ['q', 'quit'],
    handler: 'ExitCommand',
    module: '../commands/exit-command.js',
    description: 'Exit the application',
    usage: 'exit'
  },
  
  cmd: {
    aliases: ['кмд'],
    handler: 'CmdModule',
    module: '../commands/cmd/index.js',
    description: 'Interactive command management system',
    usage: 'cmd'
  }
}

/**
 * Helper function to check if a command name is a system command
 */
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

/**
 * Helper function to get command configuration by name or alias
 */
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

/**
 * Get all system command names including aliases
 */
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