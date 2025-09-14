export const SYSTEM_COMMANDS = {
  help: {
    aliases: ['h', '?'],
    handler: 'HelpCommand',
    filePath: '../commands/system/help.js',
    description: 'Show all commands and usage information',
    usage: 'help',
  },

  provider: {
    aliases: ['p'],
    handler: 'ProviderSwitch',
    filePath: '../commands/system/provider-switch.js',
    description: 'Open provider selection menu',
    usage: 'provider',
  },

  model: {
    aliases: ['m'],
    handler: 'ModelSwitch',
    filePath: '../commands/system/model-switch.js',
    description: 'Open model selection menu',
    usage: 'model',
  },

  exit: {
    aliases: ['q', 'quit'],
    handler: 'ExitCommand',
    filePath: '../commands/system/exit.js',
    description: 'Exit the application',
    usage: 'exit',
  },

  cmd: {
    aliases: ['кмд'],
    handler: 'CmdModule',
    filePath: '../commands/system/cmd/index.js',
    description: 'Interactive command management system',
    usage: 'cmd',
  },
}
