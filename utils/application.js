import { configManager } from '../config/config-manager.js'
import { logger } from './logger.js'
import { commandManager, BaseCommand } from './command-manager.js'
import { AppError, errorHandler } from './error-handler.js'
import { validateString, sanitizeString } from './validation.js'
import { color } from '../config/color.js'
import { execHelp } from './help/execHelp.js'

/**
 * Main application class with improved architecture
 */
export class Application {
  constructor(options = {}) {
    this.config = configManager
    this.logger = logger
    this.commands = commandManager
    
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
    
    this.registerCoreCommands()
  }

  /**
   * Register core application commands
   */
  registerCoreCommands() {
    // Check if help command is already registered
    if (!this.commands.hasCommand('help')) {
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
            execHelp()
            return ''
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
    }
    
    // Status command
    if (!this.commands.hasCommand('status')) {
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
- Plugins: 0/0
- Configuration: ${Object.keys(app.config.getAll()).length} keys`
        }
      })
    }
    
    // Exit command
    if (!this.commands.hasCommand('exit')) {
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
    }
    
    // Config command
    if (!this.commands.hasCommand('config')) {
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
      
      
      // Emit initialization event
      
      this.state.initialized = true
      this.logger.debug('Application initialized successfully')
    } catch (error) {
      errorHandler.handleError(error)
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
    this.logger.debug('Application started')
    
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
    this.logger.debug('Application stopped')
    
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
      
      this.logger.debug(`User input received: ${sanitizedInput.substring(0, 50)}...`)
      
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
          this.state.userSession.commandCount++
          this.logger.debug(`Command executed: ${commandName} (${duration}ms)`)
          
          return result
        } catch (error) {
          this.state.userSession.errorCount++
          this.logger.error(`Command failed: ${commandName} - ${error.message}`)
          throw error
        }
      }
      
      // Process as regular input (to be handled by subclass if needed)
      return `Unhandled input: ${sanitizedInput}`
    } catch (error) {
      errorHandler.handleError(error)
      throw error
    }
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
    this.logger.debug('Context cleared')
  }

  /**
   * Get application metrics
   */
  getMetrics() {
    return {
      session: this.state.userSession,
      config: this.config.getAll(),
      commands: this.commands.getStats(),
      providers: this.providers.getProviderStats()
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.logger.debug('Cleaning up application resources...')
    
    
    this.logger.debug('Application cleanup completed')
  }
}

// Export singleton instance
export const app = new Application()