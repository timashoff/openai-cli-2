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

  save: {
    aliases: ['sv'],
    handler: 'SaveCommand',
    filePath: '../commands/system/save.js',
    description: 'Save the current conversation (local + account sync)',
    usage: 'save [title]',
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
    handler: 'CmdCommand',
    filePath: '../commands/system/cmd.js',
    description: 'Edit command definitions in your $EDITOR; "cmd list" prints them',
    usage: 'cmd [list]',
  },

  config: {
    aliases: ['cfg'],
    handler: 'ConfigCommand',
    filePath: '../commands/system/config.js',
    description: 'Edit provider config in your $EDITOR; "config status" shows routing',
    usage: 'config [status]',
  },

  login: {
    aliases: [],
    handler: 'LoginCommand',
    filePath: '../commands/system/login.js',
    description: 'Log in to the gateway (email + password) and store the session',
    usage: 'login [gateway-url]',
    oneShot: true,
  },

  logout: {
    aliases: [],
    handler: 'LogoutCommand',
    filePath: '../commands/system/login.js',
    description: 'Revoke and remove the stored gateway session',
    usage: 'logout',
    oneShot: true,
  },

  reset: {
    aliases: [],
    handler: 'ResetCommand',
    filePath: '../commands/system/reset.js',
    description: 'Reset the gateway password via an emailed code (revokes every session)',
    usage: 'reset [gateway-url]',
    oneShot: true,
  },

  whoami: {
    aliases: ['me'],
    handler: 'WhoamiCommand',
    filePath: '../commands/system/whoami.js',
    description: 'Show login status and the gateway address (copy it to set up another device)',
    usage: 'whoami',
    oneShot: true,
  },
}
