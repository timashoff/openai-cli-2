export const SYSTEM_COMMANDS = {
  help: {
    aliases: ['h', '?'],
    handler: 'HelpCommand',
    description: 'Show all commands and usage information',
    usage: 'help',
  },

  provider: {
    aliases: ['p'],
    handler: 'ProviderSwitch',
    description: 'Open provider selection menu',
    usage: 'provider',
  },

  model: {
    aliases: ['m'],
    handler: 'ModelSwitch',
    description: 'Open model selection menu',
    usage: 'model',
  },

  exit: {
    aliases: ['q', 'quit'],
    handler: 'ExitCommand',
    description: 'Exit the application',
    usage: 'exit',
  },

  cmd: {
    aliases: ['кмд'],
    handler: 'CmdModule',
    description: 'Interactive command management system',
    usage: 'cmd',
  },
}
