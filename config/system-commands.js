export const SYSTEM_COMMANDS = {
  help: {
    aliases: ['h', '?'],
    handler: 'HelpCommand',
    module: '../commands/help-command.js',
    description: 'Show all commands and usage information',
    usage: 'help',
  },

  provider: {
    aliases: ['p'],
    handler: 'ProviderCommand',
    module: '../commands/provider-command.js',
    description: 'Open provider selection menu',
    usage: 'provider',
  },

  model: {
    aliases: ['m'],
    handler: 'ModelCommand',
    module: '../commands/model-command.js',
    description: 'Open model selection menu',
    usage: 'model',
  },

  exit: {
    aliases: ['q', 'quit'],
    handler: 'ExitCommand',
    module: '../commands/exit-command.js',
    description: 'Exit the application',
    usage: 'exit',
  },

  cmd: {
    aliases: ['кмд'],
    handler: 'CmdModule',
    module: '../commands/cmd/index.js',
    description: 'Interactive command management system',
    usage: 'cmd',
  },
}
