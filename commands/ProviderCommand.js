/**
 * ProviderCommand - AI provider switching command
 * Handles provider selection, validation, and state management
 */
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

export class ProviderCommand {
  constructor(dependencies = {}) {
    // Core dependencies
    this.stateManager = dependencies.stateManager
    this.cliInterface = dependencies.cliInterface
    this.serviceManager = dependencies.serviceManager
    
    // Provider utilities
    this.execProvider = dependencies.execProvider // From utils/provider/execProvider.js
    this.rl = dependencies.readline // Readline interface
    
    // Command metadata
    this.commandName = 'provider'
    this.aliases = ['p']
    this.description = 'Switch AI provider'
    this.usage = 'provider'
    this.category = 'ai'
    
    // Provider switching statistics
    this.stats = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      switchTimes: []
    }
  }
  
  /**
   * Initialize the provider command
   */
  async initialize() {
    logger.debug('Initializing ProviderCommand')
    
    // Load execProvider if not provided
    if (!this.execProvider) {
      const { execProvider } = await import('../utils/provider/execProvider.js')
      this.execProvider = execProvider
    }
    
    logger.debug('ProviderCommand initialized')
  }
  
  /**
   * Execute provider switching command
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   * @returns {Promise<string>} Result message
   */
  async execute(args = [], context = {}) {
    const switchId = this.generateSwitchId()
    const startTime = Date.now()
    
    logger.info(`ProviderCommand: Starting provider switch ${switchId}`)
    
    try {
      // Handle different argument patterns
      if (args.length > 0) {
        // Direct provider specification: "provider openai"
        return await this.switchToProviderByName(args[0], switchId, startTime)
      } else {
        // Interactive provider selection
        return await this.showProviderSelectionMenu(switchId, startTime)
      }
      
    } catch (error) {
      this.recordSwitch(switchId, startTime, false, error)
      logger.error(`ProviderCommand: Switch ${switchId} failed:`, error)
      throw error
    }
  }
  
  /**
   * Switch to provider by name
   * @private
   * @param {string} providerName - Provider name
   * @param {string} switchId - Switch ID for tracking
   * @param {number} startTime - Start timestamp
   * @returns {Promise<string>} Result message
   */
  async switchToProviderByName(providerName, switchId, startTime) {
    // Get available providers
    const availableProviders = await this.getAvailableProviders()
    
    // Find provider by name
    const targetProvider = availableProviders.find(provider => 
      provider.key.toLowerCase() === providerName.toLowerCase() ||
      provider.name.toLowerCase() === providerName.toLowerCase()
    )
    
    if (!targetProvider) {
      const availableNames = availableProviders.map(p => p.key).join(', ')
      throw new Error(`Provider '${providerName}' not found. Available: ${availableNames}`)
    }
    
    // Check if already using this provider
    const currentProvider = await this.getCurrentProvider()
    if (currentProvider && currentProvider.key === targetProvider.key) {
      this.recordSwitch(switchId, startTime, true)
      console.log(`${color.yellow}Already using ${targetProvider.name}${color.reset}`)
      return null
    }
    
    // Perform the switch
    await this.performProviderSwitch(targetProvider)
    
    this.recordSwitch(switchId, startTime, true)
    console.log(`${color.green}✓ Switched to ${targetProvider.name}${color.reset}`)
    return null
  }
  
  /**
   * Show interactive provider selection menu
   * @private
   * @param {string} switchId - Switch ID for tracking
   * @param {number} startTime - Start timestamp
   * @returns {Promise<string>} Result message
   */
  async showProviderSelectionMenu(switchId, startTime) {
    // Get available providers
    const availableProviders = await this.getAvailableProviders()
    const currentProvider = await this.getCurrentProvider()
    
    // Validate providers
    if (availableProviders.length === 0) {
      this.recordSwitch(switchId, startTime, false, new Error('No providers available'))
      console.log(`${color.yellow}No providers available${color.reset}`)
      return null
    }
    
    if (availableProviders.length === 1) {
      this.recordSwitch(switchId, startTime, false, new Error('Only one provider available'))
      console.log(`${color.yellow}Only one provider available: ${availableProviders[0].name}${color.reset}`)
      return null
    }
    
    // Temporarily disable raw mode for interactive selection
    const wasRawMode = this.prepareForInteractiveInput()
    
    try {
      // Show interactive provider menu using execProvider
      const selectedProvider = await this.execProvider(
        currentProvider.key, 
        availableProviders, 
        this.rl
      )
      
      // Handle user cancellation
      if (!selectedProvider) {
        this.recordSwitch(switchId, startTime, false, new Error('User cancelled'))
        console.log(`${color.yellow}Provider switch cancelled${color.reset}`)
        return null
      }
      
      // Check if user selected the same provider
      if (selectedProvider.key === currentProvider.key) {
        this.recordSwitch(switchId, startTime, true)
        console.log(`${color.yellow}Already using ${selectedProvider.name}${color.reset}`)
        return null
      }
      
      // Perform the switch
      await this.performProviderSwitch(selectedProvider)
      
      this.recordSwitch(switchId, startTime, true)
      console.log(`${color.green}✓ Switched to ${selectedProvider.name}${color.reset}`)
      return null
      
    } finally {
      // Restore raw mode
      this.restoreInteractiveInput(wasRawMode)
    }
  }
  
  /**
   * Get available providers from service manager
   * @private
   * @returns {Promise<Array>} Available providers
   */
  async getAvailableProviders() {
    if (!this.serviceManager) {
      throw new Error('Service manager not available')
    }
    
    const aiService = this.serviceManager.getAIProviderService()
    if (!aiService) {
      throw new Error('AI provider service not available')
    }
    
    return aiService.getAvailableProviders()
  }
  
  /**
   * Get current provider from service manager
   * @private
   * @returns {Promise<Object>} Current provider info
   */
  async getCurrentProvider() {
    if (!this.serviceManager) {
      throw new Error('Service manager not available')
    }
    
    const aiService = this.serviceManager.getAIProviderService()
    if (!aiService) {
      throw new Error('AI provider service not available')
    }
    
    return aiService.getCurrentProvider()
  }
  
  /**
   * Perform the actual provider switch
   * @private
   * @param {Object} selectedProvider - Selected provider
   */
  async performProviderSwitch(selectedProvider) {
    logger.info(`ProviderCommand: Switching to provider ${selectedProvider.key}`)
    
    // Switch using service manager and get result with models
    const switchResult = await this.serviceManager.switchProvider(selectedProvider.key)
    
    // Update state manager with new provider info including models from switch result
    const aiService = this.serviceManager.getAIProviderService()
    const newCurrentProvider = aiService.getCurrentProvider()
    
    this.stateManager.updateAIProvider({
      instance: newCurrentProvider.instance,
      key: newCurrentProvider.key,
      model: newCurrentProvider.model,
      models: switchResult.availableModels || []
    })
    
    logger.info(`ProviderCommand: Successfully switched to ${newCurrentProvider.key} with model ${newCurrentProvider.model}`)
  }
  
  /**
   * Prepare terminal for interactive input
   * @private
   * @returns {boolean} Whether raw mode was enabled
   */
  prepareForInteractiveInput() {
    const wasRawMode = process.stdin.isRaw
    
    if (process.stdin.isTTY && wasRawMode) {
      process.stdin.setRawMode(false)
    }
    
    return wasRawMode
  }
  
  /**
   * Restore terminal after interactive input
   * @private
   * @param {boolean} wasRawMode - Whether raw mode was previously enabled
   */
  restoreInteractiveInput(wasRawMode) {
    if (process.stdin.isTTY && wasRawMode) {
      process.stdin.setRawMode(true)
    }
  }
  
  /**
   * Try to switch to an alternative provider when current one fails
   * @param {string} currentProviderKey - Current provider key to avoid
   * @returns {Promise<Object|null>} Switched provider info or null
   */
  async tryAlternativeProvider(currentProviderKey = null) {
    const switchId = this.generateSwitchId()
    const startTime = Date.now()
    
    logger.info(`ProviderCommand: Attempting alternative provider switch ${switchId}`)
    
    try {
      // Get available providers
      const availableProviders = await this.getAvailableProviders()
      
      // Preferred order for fallback
      const preferredOrder = ['openai', 'anthropic', 'deepseek']
      
      for (const providerKey of preferredOrder) {
        // Skip current provider
        if (providerKey === currentProviderKey) {
          continue
        }
        
        // Find provider in available list
        const provider = availableProviders.find(p => p.key === providerKey)
        if (!provider) {
          continue
        }
        
        try {
          // Attempt to switch
          this.cliInterface.writeInfo(`Trying ${provider.name}...`)
          
          await this.performProviderSwitch(provider)
          
          this.recordSwitch(switchId, startTime, true)
          this.cliInterface.writeSuccess(`Successfully switched to ${provider.name}`)
          
          return provider
          
        } catch (error) {
          this.cliInterface.writeWarning(`${provider.name} also unavailable: ${error.message}`)
          continue
        }
      }
      
      // No alternative found
      this.recordSwitch(switchId, startTime, false, new Error('No alternative providers available'))
      this.cliInterface.writeError('No alternative providers available')
      
      return null
      
    } catch (error) {
      this.recordSwitch(switchId, startTime, false, error)
      logger.error(`ProviderCommand: Alternative switch ${switchId} failed:`, error)
      return null
    }
  }
  
  /**
   * Get provider switching statistics
   * @returns {Object} Provider switching statistics
   */
  getProviderStats() {
    const avgSwitchTime = this.stats.switchTimes.length > 0 
      ? this.stats.switchTimes.reduce((a, b) => a + b, 0) / this.stats.switchTimes.length 
      : 0
    
    return {
      ...this.stats,
      averageSwitchTime: Math.round(avgSwitchTime),
      successRate: this.stats.totalSwitches > 0 
        ? (this.stats.successfulSwitches / this.stats.totalSwitches * 100).toFixed(2) + '%'
        : '0%'
    }
  }
  
  /**
   * List available providers
   * @returns {Promise<string>} Formatted provider list
   */
  async listProviders() {
    try {
      const availableProviders = await this.getAvailableProviders()
      const currentProvider = await this.getCurrentProvider()
      
      if (availableProviders.length === 0) {
        return `${color.yellow}No providers available${color.reset}`
      }
      
      let output = `${color.cyan}Available providers:${color.reset}\\n`
      
      availableProviders.forEach(provider => {
        const isCurrent = currentProvider && provider.key === currentProvider.key
        const marker = isCurrent ? '●' : '○'
        const providerColor = isCurrent ? color.green : color.white
        
        output += `  ${marker} ${providerColor}${provider.name}${color.reset} (${provider.key})\\n`
        
        if (provider.models && provider.models.length > 0) {
          output += `    ${color.grey}Models: ${provider.models.slice(0, 3).join(', ')}${provider.models.length > 3 ? '...' : ''}${color.reset}\\n`
        }
      })
      
      return output
      
    } catch (error) {
      logger.error('ProviderCommand: Failed to list providers:', error)
      return `${color.red}Error: Failed to list providers - ${error.message}${color.reset}`
    }
  }
  
  /**
   * Generate unique switch ID
   * @private
   * @returns {string} Switch ID
   */
  generateSwitchId() {
    return `switch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  }
  
  /**
   * Record provider switch statistics
   * @private
   * @param {string} switchId - Switch ID
   * @param {number} startTime - Start timestamp
   * @param {boolean} success - Whether switch succeeded
   * @param {Error} error - Error object (if failed)
   */
  recordSwitch(switchId, startTime, success, error = null) {
    const switchTime = Date.now() - startTime
    
    this.stats.totalSwitches++
    if (success) {
      this.stats.successfulSwitches++
    } else {
      this.stats.failedSwitches++
    }
    
    this.stats.switchTimes.push(switchTime)
    
    // Keep only last 50 switch times
    if (this.stats.switchTimes.length > 50) {
      this.stats.switchTimes = this.stats.switchTimes.slice(-50)
    }
    
    logger.debug(`ProviderCommand: Switch ${switchId} recorded - ${success ? 'SUCCESS' : 'FAILED'} (${switchTime}ms)`)
  }
  
  /**
   * Reset provider statistics
   */
  resetStats() {
    this.stats = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      switchTimes: []
    }
    
    logger.debug('ProviderCommand: Statistics reset')
  }
  
  /**
   * Get command metadata
   * @returns {Object} Command metadata
   */
  getCommandInfo() {
    return {
      name: this.commandName,
      aliases: this.aliases,
      description: this.description,
      usage: this.usage,
      category: this.category,
      stats: this.getProviderStats()
    }
  }
}

/**
 * Create ProviderCommand instance with dependencies
 * @param {Object} dependencies - Required dependencies
 * @returns {ProviderCommand} ProviderCommand instance
 */
export function createProviderCommand(dependencies = {}) {
  return new ProviderCommand(dependencies)
}