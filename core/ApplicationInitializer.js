/**
 * ApplicationInitializer - Extracted initialization logic from monolith decomposition
 * Handles all AI provider initialization, command registration, and Phase 2 architecture setup
 */
import { createProvider } from '../utils/provider-factory.js'
import { API_PROVIDERS } from '../config/api_providers.js'
import { DEFAULT_MODELS } from '../config/default_models.js'
// Migration no longer needed - commands already in database
// import { migrateInstructionsToDatabase } from '../utils/migration.js'
// Multi-provider imports removed - using database-driven multi-model support
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { readFile } from 'node:fs/promises'
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

// Legacy Phase 2 Commands - no longer used in current architecture
// Current architecture uses CommandRouter, ProviderSwitcher, AIProcessor, CLIManager

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
    
    // Initialize multi-command processor for commands with multiple models
    await multiCommandProcessor.initialize()
    
    // Initialize MCP servers
    await this.initializeMCPServers()
    
    // Phase 2 architecture components are legacy - current architecture uses:
    // - CommandRouter for command routing
    // - ProviderSwitcher for provider switching
    // - AIProcessor for AI processing
    // - CLIManager for CLI management
    // Legacy Phase 2 components (ProviderCommand, ModelCommand, etc.) not needed
    
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
            // Fallback to default models with proper array format
            if (DEFAULT_MODELS[providerKey] && DEFAULT_MODELS[providerKey].model) {
              models = [DEFAULT_MODELS[providerKey].model]
            }
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
    
    // Set default model with proper null checking
    const models = defaultProvider.models || []
    const defaultModel = models.find(m => typeof m === 'string' && m.includes('gpt-4')) || 
                        models.find(m => typeof m === 'string' && m.includes('gpt')) ||
                        models.find(m => typeof m === 'string' && m.includes('claude')) ||
                        models[0] || 'gpt-5-mini'
    
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

  // Legacy Phase 2 architecture methods removed - not needed in current architecture
  // Current architecture uses specialized components:
  // - CommandRouter handles command routing and execution
  // - ProviderSwitcher handles provider/model switching  
  // - AIProcessor handles AI input processing and MCP
  // - CLIManager handles terminal interface
}