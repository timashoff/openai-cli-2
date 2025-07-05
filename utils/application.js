import { configManager } from '../config/config-manager.js'
import { logger } from './logger.js'
import { pluginManager } from './plugin-manager.js'
import { commandManager, BaseCommand } from './command-manager.js'
import { globalEmitter } from './event-emitter.js'
import { providerFactory } from './provider-factory.js'
import { AppError, errorHandler } from './error-handler.js'
import { validateString, sanitizeString } from './validation.js'
import { color } from '../config/color.js'

/**
 * Main application class with improved architecture
 */
export class Application {
  constructor(options = {}) {
    this.config = configManager
    this.logger = logger
    this.emitter = globalEmitter
    this.plugins = pluginManager
    this.commands = commandManager
    this.providers = providerFactory
    
    this.state = {
      initialized: false,
      running: false,
      currentProvider: null,
      contextHistory: [],
      userSession: {
        startTime: Date.now(),
        commandCount: 0,
        errorCount: 0
      }
    }
    
    this.setupEventHandlers()
    this.registerCoreCommands()
  }

  /**
   * Setup global event handlers
   */
  setupEventHandlers() {
    // Application events
    this.emitter.on('app:start', () => {
      this.logger.info('Application started')
    })
    
    this.emitter.on('app:stop', () => {
      this.logger.info('Application stopped')
    })
    
    this.emitter.on('app:error', (error) => {
      this.state.userSession.errorCount++
      errorHandler.handleError(error)
    })
    
    // Command events
    this.emitter.on('command:executed', (commandName, args, duration) => {
      this.state.userSession.commandCount++
      this.logger.debug(`Command executed: ${commandName} (${duration}ms)`)
    })
    
    this.emitter.on('command:failed', (commandName, error) => {
      this.state.userSession.errorCount++
      this.logger.error(`Command failed: ${commandName} - ${error.message}`)
    })
    
    // Provider events
    this.emitter.on('provider:changed', (providerName) => {
      this.state.currentProvider = providerName
      this.logger.info(`Provider changed to: ${providerName}`)
    })
    
    // Input events
    this.emitter.on('input:received', (input) => {
      this.logger.debug(`User input received: ${input.substring(0, 50)}...`)
    })
  }

  /**
   * Register core application commands
   */
  registerCoreCommands() {
    // Help command
    this.commands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('help', 'Show help information', {
          aliases: ['h', '?'],
          usage: 'help [command]',
          examples: ['help', 'help provider'],
          category: 'core'
        })
      }
      
      async execute(args) {
        if (args.length === 0) {
          return commandManager.generateHelp()
        } else {
          const command = commandManager.getCommand(args[0])
          if (command) {
            return command.getHelp()
          } else {
            throw new AppError(`Command not found: ${args[0]}`, true, 404)
          }
        }
      }
    })
    
    // Status command
    this.commands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('status', 'Show application status', {
          aliases: ['stat'],
          category: 'core'
        })
      }
      
      async execute() {
        const app = this
        return `Application Status:
- Uptime: ${Math.floor((Date.now() - app.state.userSession.startTime) / 1000)}s
- Commands executed: ${app.state.userSession.commandCount}
- Errors: ${app.state.userSession.errorCount}
- Current provider: ${app.state.currentProvider || 'none'}
- Context history: ${app.state.contextHistory.length} messages
- Plugins: ${app.plugins.getStats().active}/${app.plugins.getStats().total}
- Configuration: ${Object.keys(app.config.getAll()).length} keys`
      }
    })
    
    // Exit command
    this.commands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('exit', 'Exit the application', {
          aliases: ['quit', 'q'],
          category: 'core'
        })
      }
      
      async execute() {
        process.exit(0)
      }
    })
    
    // Config command
    this.commands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('config', 'Manage configuration', {
          usage: 'config <get|set|list> [key] [value]',
          examples: [
            'config list',
            'config get maxInputLength',
            'config set typingDelay 20'
          ],
          category: 'core'
        })
      }
      
      async execute(args) {
        const [action, key, value] = args
        
        switch (action) {
          case 'list':
            return JSON.stringify(configManager.getAll(), null, 2)
          
          case 'get':
            if (!key) throw new AppError('Key required for get action', true, 400)
            return `${key}: ${configManager.get(key)}`
          
          case 'set':
            if (!key || value === undefined) {
              throw new AppError('Key and value required for set action', true, 400)
            }
            configManager.set(key, parseInt(value) || value)
            return `${key} set to: ${configManager.get(key)}`
          
          default:
            throw new AppError('Invalid action. Use: get, set, or list', true, 400)
        }
      }
    })
  }

  /**
   * Initialize application
   */
  async initialize() {
    if (this.state.initialized) {
      return
    }
    
    try {
      // Load configuration
      this.config.loadFromEnv()
      this.config.validate()
      
      // Initialize logger
      await this.logger.initialize()
      
      // Initialize plugins
      await this.plugins.initializeAll()
      
      // Emit initialization event
      this.emitter.emit('app:initialized')
      
      this.state.initialized = true
      this.logger.info('Application initialized successfully')
    } catch (error) {
      this.emitter.emit('app:error', error)
      throw error
    }
  }

  /**
   * Start application
   */
  async start() {
    if (!this.state.initialized) {
      await this.initialize()
    }
    
    this.state.running = true
    this.emitter.emit('app:start')
    
    // Main application loop would go here
    // For now, this is just a framework
  }

  /**
   * Stop application
   */
  async stop() {
    if (!this.state.running) {
      return
    }
    
    this.state.running = false
    this.emitter.emit('app:stop')
    
    // Cleanup resources
    await this.cleanup()
  }

  /**
   * Process user input
   */
  async processInput(input) {
    try {
      // Validate and sanitize input
      const sanitizedInput = sanitizeString(input)
      validateString(sanitizedInput, 'user input', true)
      
      this.emitter.emit('input:received', sanitizedInput)
      
      // Check if it's a command
      const words = sanitizedInput.trim().split(' ')
      const commandName = words[0]
      const args = words.slice(1)
      
      if (this.commands.hasCommand(commandName)) {
        const startTime = Date.now()
        try {
          const result = await this.commands.executeCommand(commandName, args, {
            app: this,
            user: this.state.userSession
          })
          
          const duration = Date.now() - startTime
          this.emitter.emit('command:executed', commandName, args, duration)
          
          return result
        } catch (error) {
          this.emitter.emit('command:failed', commandName, error)
          throw error
        }
      }
      
      // Process as regular AI input
      return await this.processAIInput(sanitizedInput)
    } catch (error) {
      this.emitter.emit('app:error', error)
      throw error
    }
  }

  /**
   * Process AI input (placeholder for actual AI processing)
   */
  async processAIInput(input) {
    // This would integrate with the existing AI processing logic
    // For now, just return a placeholder
    return `AI response to: ${input}`
  }

  /**
   * Add message to context history
   */
  addToContext(role, content) {
    this.state.contextHistory.push({ role, content, timestamp: Date.now() })
    
    const maxHistory = this.config.get('maxContextHistory')
    if (this.state.contextHistory.length > maxHistory) {
      this.state.contextHistory = this.state.contextHistory.slice(-maxHistory)
    }
  }

  /**
   * Clear context history
   */
  clearContext() {
    this.state.contextHistory = []
    this.emitter.emit('context:cleared')
  }

  /**
   * Get application metrics
   */
  getMetrics() {
    return {
      session: this.state.userSession,
      config: this.config.getAll(),
      plugins: this.plugins.getStats(),
      commands: this.commands.getStats(),
      events: this.emitter.getStats(),
      providers: this.providers.getProviderStats()
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.logger.info('Cleaning up application resources...')
    
    // Deactivate plugins
    for (const plugin of this.plugins.getActivePlugins()) {
      try {
        await this.plugins.deactivatePlugin(plugin.name)
      } catch (error) {
        this.logger.error(`Failed to deactivate plugin ${plugin.name}:`, error.message)
      }
    }
    
    // Clear event listeners
    this.emitter.removeAllListeners()
    
    this.logger.info('Application cleanup completed')
  }
}

// Export singleton instance
export const app = new Application()