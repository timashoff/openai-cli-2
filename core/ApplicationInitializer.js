/**
 * ApplicationInitializer - Extracted initialization logic from monolith decomposition
 * Handles all AI provider initialization, command registration, and Phase 2 architecture setup
 */
import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
// Migration no longer needed - commands already in database
// import { migrateInstructionsToDatabase } from '../utils/migration.js'
import { multiProviderTranslator } from '../utils/multi-provider-translator.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { readFile } from 'node:fs/promises'
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

// Phase 2 Commands
import { CommandExecutor } from '../commands/CommandExecutor.js'
import { ProviderCommand } from '../commands/ProviderCommand.js'
import { ModelCommand } from '../commands/ModelCommand.js'
import { HelpCommand } from '../commands/HelpCommand.js'

export class ApplicationInitializer {
  constructor(app) {
    this.app = app
  }

  /**
   * Initialize all AI providers (extracted from original logic)
   */
  async initializeAI() {
    // Migrate legacy instructions to database
    // Migration no longer needed - commands already in database
    // await migrateInstructionsToDatabase()
    
    // Initialize AI providers
    await this.initializeProviders()
    
    // Initialize multi-provider systems
    await multiProviderTranslator.initialize()
    await multiCommandProcessor.initialize()
    
    // Initialize MCP servers
    await this.initializeMCPServers()
    
    // Initialize Phase 2 architecture
    await this.initializePhase2Architecture()
    
    // Register AI commands
    // Commands are now handled through database only
    // await this.registerAICommands() // DISABLED - all commands in DB
    
    logger.debug('✅ AI initialization completed')
  }

  /**
   * Initialize AI providers (extracted from original logic)
   */
  async initializeProviders() {
    const availableProviders = []

    for (const [providerKey, config] of Object.entries(API_PROVIDERS)) {
      if (process.env[config.apiKeyEnv]) {
        try {
          const provider = createProvider(providerKey, config)
          await provider.initializeClient()
          
          let models = []
          try {
            models = await provider.listModels()
          } catch (error) {
            logger.warn(`Failed to list models for ${providerKey}: ${error.message}`)
            models = DEFAULT_MODELS[providerKey] || []
          }

          availableProviders.push({
            key: providerKey,
            name: config.name,
            provider,
            models
          })
          
          logger.debug(`Provider initialized: ${config.name}`)
        } catch (error) {
          logger.warn(`Failed to initialize ${providerKey}: ${error.message}`)
        }
      }
    }

    if (availableProviders.length === 0) {
      throw new Error('No AI providers available. Please check your API keys.')
    }

    // Set default provider (first available)
    const defaultProvider = availableProviders[0]
    this.app.aiState.provider = defaultProvider.provider
    this.app.aiState.models = defaultProvider.models
    this.app.aiState.selectedProviderKey = defaultProvider.key
    
    // Set default model
    const defaultModel = defaultProvider.models.find(m => typeof m === 'string' && m.includes('gpt-4')) || 
                        defaultProvider.models.find(m => typeof m === 'string' && m.includes('gpt')) ||
                        defaultProvider.models.find(m => typeof m === 'string' && m.includes('claude')) ||
                        defaultProvider.models[0]
    
    this.app.aiState.model = defaultModel
    process.title = defaultModel

    logger.debug(`Default provider set: ${defaultProvider.name}`)
    logger.debug(`Default model set: ${defaultModel}`)
  }

  /**
   * Initialize MCP servers (extracted from original logic)
   */
  async initializeMCPServers() {
    try {
      // Built-in MCP servers are ready (no initialization needed)
      logger.debug('Built-in MCP servers: fetch, web-search ready')
      
      // Initialize external MCP servers from config
      const mcpConfigPath = new URL('../config/mcp-servers.json', import.meta.url).pathname
      try {
        const mcpConfigContent = await readFile(mcpConfigPath, 'utf-8')
        const mcpConfig = JSON.parse(mcpConfigContent)
        
        for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers || {})) {
          try {
            await mcpManager.startServer(serverName, serverConfig)
            logger.debug(`External MCP server started: ${serverName}`)
          } catch (error) {
            logger.warn(`Failed to start MCP server ${serverName}: ${error.message}`)
          }
        }
      } catch (error) {
        logger.debug('No external MCP servers configured or config file missing')
      }
      
      logger.debug('✅ MCP servers initialized')
    } catch (error) {
      logger.warn(`MCP initialization failed: ${error.message}`)
    }
  }

  /**
   * Initialize Phase 2 architecture (extracted from original logic)
   */
  async initializePhase2Architecture() {
    logger.debug('🚀 Initializing Phase 2 Architecture')
    
    // Initialize modern commands with business logic
    this.app.providerCommand = new ProviderCommand({
      app: this.app,
      serviceManager: this.app.serviceManager,
      aiState: this.app.aiState,
      rl: this.app.cliManager.rl
    })
    
    this.app.modelCommand = new ModelCommand({
      app: this.app,
      aiState: this.app.aiState,
      rl: this.app.cliManager.rl  
    })
    
    this.app.helpCommand = new HelpCommand({
      app: this.app
    })
    
    // Initialize command executor
    this.app.commandExecutor = new CommandExecutor({
      app: this.app,
      providerCommand: this.app.providerCommand,
      modelCommand: this.app.modelCommand,
      helpCommand: this.app.helpCommand
    })
    
    logger.debug('✅ Phase 2 Architecture initialized')
  }

  /**
   * Register AI commands (extracted from original logic)
   */
  async registerAICommands() {
    const { BaseCommand } = await import('../utils/command-manager.js')
    
    // Provider command with full business logic
    this.app.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('provider', 'Switch AI provider', {
          aliases: ['p'],
          usage: 'provider',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchProvider()
      }
    })
    
    // Model command with full business logic
    this.app.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('model', 'Switch AI model', {
          aliases: ['m'],
          usage: 'model',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        return await context.app.switchModel()
      }
    })
    
    // Web command (original business logic)
    this.app.aiCommands.registerCommand(new class extends BaseCommand {
      constructor() {
        super('web', 'Open link in browser', {
          aliases: ['w'],
          usage: 'web <number>',
          category: 'ai'
        })
      }
      
      async execute(args, context) {
        if (args.length === 0) {
          return `${color.yellow}Usage: web <number> or web-<number>${color.reset}\\nExample: web 1 or web-5 - opens link from recent extraction`
        }
        
        let linkNumber
        if (args[0].startsWith('-')) {
          linkNumber = parseInt(args[0].substring(1))
        } else {
          linkNumber = parseInt(args[0])
        }
        
        if (isNaN(linkNumber) || linkNumber < 1) {
          return `${color.red}Error: Please provide a valid link number (1, 2, 3, etc.) or use web-N format${color.reset}`
        }
        
        return await context.app.openLinkInBrowser(linkNumber)
      }
    })

    logger.debug('✅ AI commands registered')
  }
}