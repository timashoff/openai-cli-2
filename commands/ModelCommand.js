/**
 * ModelCommand - AI model switching command
 * Handles model selection, validation, and state management
 */
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { errorHandler } from '../utils/error-handler.js'

export class ModelCommand {
  constructor(dependencies = {}) {
    // Core dependencies
    this.stateManager = dependencies.stateManager
    this.cliInterface = dependencies.cliInterface
    this.serviceManager = dependencies.serviceManager
    
    // Model utilities
    this.execModel = dependencies.execModel // From utils/model/execModel.js
    this.rl = dependencies.readline // Readline interface
    
    // Command metadata
    this.commandName = 'model'
    this.aliases = ['m']
    this.description = 'Switch AI model'
    this.usage = 'model [model_name]'
    this.category = 'ai'
    
    // Model switching statistics
    this.stats = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      switchTimes: [],
      modelUsage: {} // Track which models are used most
    }
  }
  
  /**
   * Initialize the model command
   */
  async initialize() {
    logger.debug('Initializing ModelCommand')
    
    // Load execModel if not provided
    if (!this.execModel) {
      const { execModel } = await import('../utils/model/execModel.js')
      this.execModel = execModel
    }
    
    logger.debug('ModelCommand initialized')
  }
  
  /**
   * Execute model switching command
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   * @returns {Promise<string>} Result message
   */
  async execute(args = [], context = {}) {
    const switchId = this.generateSwitchId()
    const startTime = Date.now()
    
    logger.info(`ModelCommand: Starting model switch ${switchId}`)
    
    try {
      // Handle different argument patterns
      if (args.length > 0) {
        // Direct model specification: "model gpt-4"
        return await this.switchToModelByName(args.join(' '), switchId, startTime)
      } else {
        // Interactive model selection
        return await this.showModelSelectionMenu(switchId, startTime)
      }
      
    } catch (error) {
      this.recordSwitch(switchId, startTime, false, error)
      logger.error(`ModelCommand: Switch ${switchId} failed:`, error)
      throw error
    }
  }
  
  /**
   * Switch to model by name
   * @private
   * @param {string} modelName - Model name (partial match allowed)
   * @param {string} switchId - Switch ID for tracking
   * @param {number} startTime - Start timestamp
   * @returns {Promise<string>} Result message
   */
  async switchToModelByName(modelName, switchId, startTime) {
    // Get available models
    const availableModels = await this.getAvailableModels()
    const currentModel = await this.getCurrentModel()
    
    // Find model by name (exact match first, then partial)
    let targetModel = availableModels.find(model => 
      model.toLowerCase() === modelName.toLowerCase()
    )
    
    if (!targetModel) {
      // Try partial match
      const partialMatches = availableModels.filter(model =>
        model.toLowerCase().includes(modelName.toLowerCase())
      )
      
      if (partialMatches.length === 1) {
        targetModel = partialMatches[0]
      } else if (partialMatches.length > 1) {
        const matchList = partialMatches.join(', ')
        throw new Error(`Multiple models match '${modelName}': ${matchList}`)
      } else {
        const availableList = availableModels.slice(0, 5).join(', ')
        throw new Error(`Model '${modelName}' not found. Available: ${availableList}...`)
      }
    }
    
    // Check if already using this model
    if (currentModel === targetModel) {
      this.recordSwitch(switchId, startTime, true)
      return `${color.yellow}Already using ${targetModel}${color.reset}`
    }
    
    // Perform the switch
    await this.performModelSwitch(targetModel)
    
    this.recordSwitch(switchId, startTime, true, null, targetModel)
    return `${color.green}✓ Switched to ${targetModel}${color.reset}`
  }
  
  /**
   * Show interactive model selection menu
   * @private
   * @param {string} switchId - Switch ID for tracking
   * @param {number} startTime - Start timestamp
   * @returns {Promise<string>} Result message
   */
  async showModelSelectionMenu(switchId, startTime) {
    // Get available models
    const availableModels = await this.getAvailableModels()
    const currentModel = await this.getCurrentModel()
    
    // Validate models
    if (availableModels.length === 0) {
      this.recordSwitch(switchId, startTime, false, new Error('No models available'))
      return `${color.yellow}No models available${color.reset}`
    }
    
    if (availableModels.length === 1) {
      this.recordSwitch(switchId, startTime, false, new Error('Only one model available'))
      return `${color.yellow}Only one model available: ${availableModels[0]}${color.reset}`
    }
    
    // Temporarily disable raw mode for interactive selection
    const wasRawMode = this.prepareForInteractiveInput()
    
    try {
      // Show interactive model menu using execModel
      const selectedModel = await this.execModel(
        currentModel,
        availableModels,
        this.rl
      )
      
      // Handle user cancellation
      if (!selectedModel) {
        this.recordSwitch(switchId, startTime, false, new Error('User cancelled'))
        return `${color.yellow}Model switch cancelled${color.reset}`
      }
      
      // Check if user selected the same model
      if (selectedModel === currentModel) {
        this.recordSwitch(switchId, startTime, true, null, selectedModel)
        return `${color.yellow}Already using ${selectedModel}${color.reset}`
      }
      
      // Perform the switch
      await this.performModelSwitch(selectedModel)
      
      this.recordSwitch(switchId, startTime, true, null, selectedModel)
      return `${color.green}✓ Switched to ${selectedModel}${color.reset}`
      
    } finally {
      // Restore raw mode
      this.restoreInteractiveInput(wasRawMode)
    }
  }
  
  /**
   * Get available models for current provider
   * @private
   * @returns {Promise<Array>} Available models
   */
  async getAvailableModels() {
    const aiState = this.stateManager.getAIState()
    
    if (!aiState.models || aiState.models.length === 0) {
      // Try to refresh models from provider
      if (aiState.provider && aiState.provider.listModels) {
        try {
          const modelList = await aiState.provider.listModels()
          const modelIds = modelList.map(m => m.id).sort((a, b) => a.localeCompare(b))
          
          // Update state with fresh model list
          this.stateManager.updateAIProvider({
            ...aiState,
            models: modelIds
          })
          
          return modelIds
        } catch (error) {
          logger.warn('Failed to refresh models from provider:', error)
        }
      }
      
      throw new Error('No models available for current provider')
    }
    
    return aiState.models
  }
  
  /**
   * Get current model
   * @private
   * @returns {Promise<string>} Current model
   */
  async getCurrentModel() {
    const aiState = this.stateManager.getAIState()
    return aiState.model || ''
  }
  
  /**
   * Perform the actual model switch
   * @private
   * @param {string} selectedModel - Selected model ID
   */
  async performModelSwitch(selectedModel) {
    logger.info(`ModelCommand: Switching to model ${selectedModel}`)
    
    // Update state manager with new model
    this.stateManager.updateModel(selectedModel)
    
    // Update process title
    if (typeof process !== 'undefined' && process.title) {
      process.title = selectedModel
    }
    
    logger.info(`ModelCommand: Successfully switched to ${selectedModel}`)
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
   * List available models with current model highlighted
   * @returns {Promise<string>} Formatted model list
   */
  async listModels() {
    try {
      const availableModels = await this.getAvailableModels()
      const currentModel = await this.getCurrentModel()
      
      if (availableModels.length === 0) {
        return `${color.yellow}No models available${color.reset}`
      }
      
      let output = `${color.cyan}Available models for current provider:${color.reset}\\n`
      
      // Group models by type for better display
      const modelGroups = this.groupModelsByType(availableModels)
      
      for (const [groupName, models] of Object.entries(modelGroups)) {
        if (models.length > 0) {
          output += `\\n${color.blue}${groupName}:${color.reset}\\n`
          
          models.forEach(model => {
            const isCurrent = model === currentModel
            const marker = isCurrent ? '●' : '○'
            const modelColor = isCurrent ? color.green : color.white
            
            output += `  ${marker} ${modelColor}${model}${color.reset}\\n`
          })
        }
      }
      
      // Add usage statistics if available
      const mostUsedModel = this.getMostUsedModel()
      if (mostUsedModel && mostUsedModel !== currentModel) {
        output += `\\n${color.grey}Most used: ${mostUsedModel}${color.reset}\\n`
      }
      
      return output
      
    } catch (error) {
      logger.error('ModelCommand: Failed to list models:', error)
      return `${color.red}Error: Failed to list models - ${error.message}${color.reset}`
    }
  }
  
  /**
   * Group models by type for better organization
   * @private
   * @param {Array} models - Model list
   * @returns {Object} Grouped models
   */
  groupModelsByType(models) {
    const groups = {
      'GPT-4': [],
      'GPT-3.5': [],
      'Claude': [],
      'DeepSeek': [],
      'Other': []
    }
    
    models.forEach(model => {
      const lowerModel = model.toLowerCase()
      
      if (lowerModel.includes('gpt-4')) {
        groups['GPT-4'].push(model)
      } else if (lowerModel.includes('gpt-3.5')) {
        groups['GPT-3.5'].push(model)
      } else if (lowerModel.includes('claude')) {
        groups['Claude'].push(model)
      } else if (lowerModel.includes('deepseek')) {
        groups['DeepSeek'].push(model)
      } else {
        groups['Other'].push(model)
      }
    })
    
    // Remove empty groups
    Object.keys(groups).forEach(key => {
      if (groups[key].length === 0) {
        delete groups[key]
      }
    })
    
    return groups
  }
  
  /**
   * Get most used model from statistics
   * @private
   * @returns {string|null} Most used model
   */
  getMostUsedModel() {
    const usage = this.stats.modelUsage
    const modelEntries = Object.entries(usage)
    
    if (modelEntries.length === 0) {
      return null
    }
    
    return modelEntries.reduce((a, b) => usage[a[0]] > usage[b[0]] ? a : b)[0]
  }
  
  /**
   * Get model switching statistics
   * @returns {Object} Model switching statistics
   */
  getModelStats() {
    const avgSwitchTime = this.stats.switchTimes.length > 0 
      ? this.stats.switchTimes.reduce((a, b) => a + b, 0) / this.stats.switchTimes.length 
      : 0
    
    return {
      ...this.stats,
      averageSwitchTime: Math.round(avgSwitchTime),
      successRate: this.stats.totalSwitches > 0 
        ? (this.stats.successfulSwitches / this.stats.totalSwitches * 100).toFixed(2) + '%'
        : '0%',
      mostUsedModel: this.getMostUsedModel()
    }
  }
  
  /**
   * Generate unique switch ID
   * @private
   * @returns {string} Switch ID
   */
  generateSwitchId() {
    return `model_switch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  }
  
  /**
   * Record model switch statistics
   * @private
   * @param {string} switchId - Switch ID
   * @param {number} startTime - Start timestamp
   * @param {boolean} success - Whether switch succeeded
   * @param {Error} error - Error object (if failed)
   * @param {string} modelName - Model name (if successful)
   */
  recordSwitch(switchId, startTime, success, error = null, modelName = null) {
    const switchTime = Date.now() - startTime
    
    this.stats.totalSwitches++
    if (success) {
      this.stats.successfulSwitches++
      
      // Track model usage
      if (modelName) {
        this.stats.modelUsage[modelName] = (this.stats.modelUsage[modelName] || 0) + 1
      }
    } else {
      this.stats.failedSwitches++
    }
    
    this.stats.switchTimes.push(switchTime)
    
    // Keep only last 50 switch times
    if (this.stats.switchTimes.length > 50) {
      this.stats.switchTimes = this.stats.switchTimes.slice(-50)
    }
    
    logger.debug(`ModelCommand: Switch ${switchId} recorded - ${success ? 'SUCCESS' : 'FAILED'} (${switchTime}ms)`)
  }
  
  /**
   * Reset model statistics
   */
  resetStats() {
    this.stats = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      switchTimes: [],
      modelUsage: {}
    }
    
    logger.debug('ModelCommand: Statistics reset')
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
      stats: this.getModelStats()
    }
  }
}

/**
 * Create ModelCommand instance with dependencies
 * @param {Object} dependencies - Required dependencies
 * @returns {ModelCommand} ModelCommand instance
 */
export function createModelCommand(dependencies = {}) {
  return new ModelCommand(dependencies)
}