/**
 * HelpCommand - Comprehensive help system
 * Provides help information for all commands, features, and system capabilities
 */
import { color } from '../config/color.js'
import { logger } from '../utils/logger.js'
import { getCommandsFromDB } from '../utils/database-manager.js'

export class HelpCommand {
  constructor(dependencies = {}) {
    // Core dependencies
    this.stateManager = dependencies.stateManager
    this.cliInterface = dependencies.cliInterface
    this.serviceManager = dependencies.serviceManager
    this.commandExecutor = dependencies.commandExecutor
    
    // Command managers for help information
    this.systemCommands = dependencies.systemCommands
    this.aiCommands = dependencies.aiCommands
    
    // Command metadata
    this.commandName = 'help'
    this.aliases = ['h', '?']
    this.description = 'Show help information'
    this.usage = 'help [command]'
    this.category = 'system'
    
    // Help sections
    this.helpSections = {
      'commands': 'Available commands',
      'translation': 'Translation commands',
      'providers': 'AI providers',
      'models': 'Model selection',
      'features': 'Advanced features',
      'shortcuts': 'Keyboard shortcuts',
      'examples': 'Usage examples'
    }
    
    // Help request statistics
    this.stats = {
      totalRequests: 0,
      sectionRequests: {},
      commandRequests: {}
    }
  }
  
  /**
   * Initialize the help command
   */
  async initialize() {
    logger.debug('Initializing HelpCommand')
    
    // Initialize section request tracking
    Object.keys(this.helpSections).forEach(section => {
      this.stats.sectionRequests[section] = 0
    })
    
    logger.debug('HelpCommand initialized')
  }
  
  /**
   * Execute help command
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   * @returns {Promise<string>} Help information
   */
  async execute(args = [], context = {}) {
    const helpId = this.generateHelpId()
    
    logger.debug(`HelpCommand: Processing help request ${helpId} with args: [${args.join(', ')}]`)
    
    try {
      this.stats.totalRequests++
      
      if (args.length === 0) {
        // General help
        return await this.showGeneralHelp()
      }
      
      const topic = args[0].toLowerCase()
      
      // Check if it's a help section
      if (this.helpSections[topic]) {
        this.stats.sectionRequests[topic]++
        return await this.showSectionHelp(topic)
      }
      
      // Check if it's a specific command
      this.stats.commandRequests[topic] = (this.stats.commandRequests[topic] || 0) + 1
      return await this.showCommandHelp(topic)
      
    } catch (error) {
      logger.error(`HelpCommand: Help request ${helpId} failed:`, error)
      return `${color.red}Error: Failed to show help - ${error.message}${color.reset}`
    }
  }
  
  /**
   * Show general help overview
   * @private
   * @returns {Promise<string>} General help content
   */
  async showGeneralHelp() {
    let output = `${color.cyan}┌─ OpenAI CLI 2 - Help System ─┐${color.reset}\\n`
    output += `${color.cyan}│                              │${color.reset}\\n`
    output += `${color.cyan}└──────────────────────────────┘${color.reset}\\n\\n`
    
    // Current status
    const aiState = this.stateManager.getAIState()
    output += `${color.green}Current Status:${color.reset}\\n`
    output += `  Provider: ${color.yellow}${aiState.selectedProviderKey || 'None'}${color.reset}\\n`
    output += `  Model: ${color.yellow}${aiState.model || 'None'}${color.reset}\\n\\n`
    
    // Quick start
    output += `${color.blue}Quick Start:${color.reset}\\n`
    output += `  ${color.white}provider${color.reset}     - Switch AI provider\\n`
    output += `  ${color.white}model${color.reset}        - Switch AI model\\n`
    output += `  ${color.white}aa text${color.reset}      - Translate to English\\n`
    output += `  ${color.white}rr text${color.reset}      - Translate to Russian\\n`
    output += `  ${color.white}help commands${color.reset} - Show all commands\\n\\n`
    
    // Help sections
    output += `${color.blue}Help Topics:${color.reset}\\n`
    Object.entries(this.helpSections).forEach(([key, description]) => {
      output += `  ${color.white}help ${key.padEnd(12)}${color.reset} - ${description}\\n`
    })
    
    output += `\\n${color.grey}Type 'help <topic>' or 'help <command>' for specific help.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show help for a specific section
   * @private
   * @param {string} section - Help section name
   * @returns {Promise<string>} Section help content
   */
  async showSectionHelp(section) {
    switch (section) {
      case 'commands':
        return await this.showCommandsHelp()
      case 'translation':
        return await this.showTranslationHelp()
      case 'providers':
        return await this.showProvidersHelp()
      case 'models':
        return await this.showModelsHelp()
      case 'features':
        return await this.showFeaturesHelp()
      case 'shortcuts':
        return await this.showShortcutsHelp()
      case 'examples':
        return await this.showExamplesHelp()
      default:
        return `${color.red}Unknown help section: ${section}${color.reset}`
    }
  }
  
  /**
   * Show all available commands
   * @private
   * @returns {Promise<string>} Commands help content
   */
  async showCommandsHelp() {
    let output = `${color.cyan}Available Commands:${color.reset}\\n\\n`
    
    // System commands
    output += `${color.blue}System Commands:${color.reset}\\n`
    if (this.systemCommands) {
      const systemCommandsList = this.systemCommands.getCommands()
      Object.values(systemCommandsList).forEach(cmd => {
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : ''
        output += `  ${color.white}${cmd.name}${aliases.padEnd(15)}${color.reset} - ${cmd.description}\\n`
      })
    } else {
      output += `  ${color.white}help${color.reset}          - Show help information\\n`
      output += `  ${color.white}exit, q${color.reset}       - Exit the application\\n`
    }
    
    output += `\\n${color.blue}AI Commands:${color.reset}\\n`
    if (this.aiCommands) {
      const aiCommandsList = this.aiCommands.getCommands()
      Object.values(aiCommandsList).forEach(cmd => {
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : ''
        output += `  ${color.white}${cmd.name}${aliases.padEnd(15)}${color.reset} - ${cmd.description}\\n`
      })
    } else {
      output += `  ${color.white}provider, p${color.reset}   - Switch AI provider\\n`
      output += `  ${color.white}model, m${color.reset}      - Switch AI model\\n`
      output += `  ${color.white}web, w${color.reset}        - Open web link\\n`
      output += `  ${color.white}cmd${color.reset}           - Manage custom commands\\n`
    }
    
    // Translation commands from database
    try {
      const instructions = getCommandsFromDB()
      if (Object.keys(instructions).length > 0) {
        output += `\\n${color.blue}Translation Commands:${color.reset}\\n`
        
        const translationCommands = [
          'ENGLISH', 'RUSSIAN', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
        ]
        
        translationCommands.forEach(cmdId => {
          if (instructions[cmdId]) {
            const cmd = instructions[cmdId]
            const keys = cmd.key.join(', ')
            output += `  ${color.white}${keys.padEnd(15)}${color.reset} - ${cmd.description}\\n`
          }
        })
        
        // Other commands
        const otherCommands = Object.entries(instructions).filter(([id]) => 
          !translationCommands.includes(id)
        )
        
        if (otherCommands.length > 0) {
          output += `\\n${color.blue}Other Commands:${color.reset}\\n`
          otherCommands.forEach(([id, cmd]) => {
            const keys = cmd.key.join(', ')
            output += `  ${color.white}${keys.padEnd(15)}${color.reset} - ${cmd.description}\\n`
          })
        }
      }
    } catch (error) {
      output += `\\n${color.yellow}Note: Could not load custom commands from database${color.reset}\\n`
    }
    
    return output
  }
  
  /**
   * Show translation commands help
   * @private
   * @returns {Promise<string>} Translation help content
   */
  async showTranslationHelp() {
    let output = `${color.cyan}Translation Commands:${color.reset}\\n\\n`
    
    output += `${color.blue}Basic Translation:${color.reset}\\n`
    output += `  ${color.white}aa <text>${color.reset}      - Translate to English (multiple variants)\\n`
    output += `  ${color.white}rr <text>${color.reset}      - Translate to Russian\\n`
    output += `  ${color.white}cc <text>${color.reset}      - Translate to Chinese\\n\\n`
    
    output += `${color.blue}Chinese Learning:${color.reset}\\n`
    output += `  ${color.white}pp <text>${color.reset}      - Show Pinyin transcription\\n`
    output += `  ${color.white}hsk <word>${color.reset}     - Translate + English + Russian + Pinyin\\n`
    output += `  ${color.white}hskss <word>${color.reset}   - Create Chinese sentence + translate\\n\\n`
    
    output += `${color.blue}Text Processing:${color.reset}\\n`
    output += `  ${color.white}gg <text>${color.reset}      - Check grammar\\n`
    output += `  ${color.white}tr <text>${color.reset}      - English transcription\\n`
    output += `  ${color.white}ss <words>${color.reset}     - Create simple sentence\\n\\n`
    
    output += `${color.blue}Special Features:${color.reset}\\n`
    output += `  ${color.white}aa http://...${color.reset}  - Translate webpage content\\n`
    output += `  ${color.white}rr $$ --force${color.reset}  - Translate clipboard, bypass cache\\n\\n`
    
    output += `${color.grey}Tip: Use $$ to insert clipboard content into any command.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show providers help
   * @private
   * @returns {Promise<string>} Providers help content
   */
  async showProvidersHelp() {
    let output = `${color.cyan}AI Providers:${color.reset}\\n\\n`
    
    try {
      if (this.serviceManager) {
        const aiService = this.serviceManager.getAIProviderService()
        if (aiService) {
          const providers = aiService.getAvailableProviders()
          const current = aiService.getCurrentProvider()
          
          output += `${color.blue}Available Providers:${color.reset}\\n`
          providers.forEach(provider => {
            const isCurrent = current && provider.key === current.key
            const marker = isCurrent ? '●' : '○'
            const providerColor = isCurrent ? color.green : color.white
            
            output += `  ${marker} ${providerColor}${provider.name}${color.reset} (${provider.key})\\n`
            
            if (provider.models && provider.models.length > 0) {
              const modelCount = provider.models.length
              output += `    ${color.grey}${modelCount} models available${color.reset}\\n`
            }
          })
        }
      }
    } catch (error) {
      output += `${color.yellow}Could not load provider information${color.reset}\\n`
    }
    
    output += `\\n${color.blue}Provider Commands:${color.reset}\\n`
    output += `  ${color.white}provider${color.reset}        - Interactive provider selection\\n`
    output += `  ${color.white}provider openai${color.reset} - Switch to specific provider\\n\\n`
    
    output += `${color.blue}Environment Variables:${color.reset}\\n`
    output += `  ${color.white}OPENAI_API_KEY${color.reset}    - OpenAI API key\\n`
    output += `  ${color.white}DEEPSEEK_API_KEY${color.reset}   - DeepSeek API key\\n`
    output += `  ${color.white}ANTHROPIC_API_KEY${color.reset}  - Anthropic API key\\n\\n`
    
    output += `${color.grey}Providers automatically fallback if current one fails.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show models help
   * @private
   * @returns {Promise<string>} Models help content
   */
  async showModelsHelp() {
    let output = `${color.cyan}AI Models:${color.reset}\\n\\n`
    
    try {
      const aiState = this.stateManager.getAIState()
      if (aiState.models && aiState.models.length > 0) {
        output += `${color.blue}Available Models for ${aiState.selectedProviderKey}:${color.reset}\\n`
        
        aiState.models.forEach(model => {
          const isCurrent = model === aiState.model
          const marker = isCurrent ? '●' : '○'
          const modelColor = isCurrent ? color.green : color.white
          
          output += `  ${marker} ${modelColor}${model}${color.reset}\\n`
        })
      }
    } catch (error) {
      output += `${color.yellow}Could not load model information${color.reset}\\n`
    }
    
    output += `\\n${color.blue}Model Commands:${color.reset}\\n`
    output += `  ${color.white}model${color.reset}           - Interactive model selection\\n`
    output += `  ${color.white}model gpt-4${color.reset}     - Switch to specific model\\n`
    output += `  ${color.white}model gpt${color.reset}       - Partial match (if unique)\\n\\n`
    
    output += `${color.blue}Model Types:${color.reset}\\n`
    output += `  ${color.white}GPT-4${color.reset}           - Most capable, slower, expensive\\n`
    output += `  ${color.white}GPT-3.5${color.reset}         - Fast, good for simple tasks\\n`
    output += `  ${color.white}Claude${color.reset}          - Good reasoning, long context\\n`
    output += `  ${color.white}DeepSeek${color.reset}        - Cost-effective alternative\\n\\n`
    
    output += `${color.grey}Model choice affects response quality and speed.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show advanced features help
   * @private
   * @returns {Promise<string>} Features help content
   */
  async showFeaturesHelp() {
    let output = `${color.cyan}Advanced Features:${color.reset}\\n\\n`
    
    output += `${color.blue}Clipboard Integration:${color.reset}\\n`
    output += `  ${color.white}$$${color.reset}              - Insert clipboard content\\n`
    output += `  ${color.white}aa $$${color.reset}           - Translate clipboard content\\n`
    output += `  ${color.white}gg $$ --force${color.reset}   - Grammar check, bypass cache\\n\\n`
    
    output += `${color.blue}Web Content Processing:${color.reset}\\n`
    output += `  ${color.white}aa https://...${color.reset}  - Translate webpage\\n`
    output += `  ${color.white}search cats${color.reset}     - Web search (auto-detected)\\n`
    output += `  ${color.white}web-5${color.reset}          - Open extracted link #5\\n\\n`
    
    output += `${color.blue}Caching System:${color.reset}\\n`
    output += `  ${color.white}--force, -f${color.reset}     - Bypass cache\\n`
    output += `  ${color.white}[from cache]${color.reset}    - Cached response indicator\\n\\n`
    
    output += `${color.blue}Context Management:${color.reset}\\n`
    output += `  ${color.white}(empty input)${color.reset}   - Clear context history\\n`
    output += `  ${color.white}...dots...${color.reset}      - Context length indicator\\n\\n`
    
    output += `${color.blue}Custom Commands:${color.reset}\\n`
    output += `  ${color.white}cmd${color.reset}             - Open command editor\\n`
    output += `  ${color.white}Add/Edit/Delete${color.reset} - Manage custom commands\\n\\n`
    
    output += `${color.blue}Multi-Provider Support:${color.reset}\\n`
    output += `  ${color.white}Auto-fallback${color.reset}   - Switch on provider failure\\n`
    output += `  ${color.white}Region blocking${color.reset} - Automatic alternative selection\\n\\n`
    
    output += `${color.grey}Most features work with any translation command.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show keyboard shortcuts help
   * @private
   * @returns {Promise<string>} Shortcuts help content
   */
  async showShortcutsHelp() {
    let output = `${color.cyan}Keyboard Shortcuts:${color.reset}\\n\\n`
    
    output += `${color.blue}During Request:${color.reset}\\n`
    output += `  ${color.white}ESC${color.reset}             - Cancel current request\\n`
    output += `  ${color.white}Ctrl+C${color.reset}         - Force terminate application\\n\\n`
    
    output += `${color.blue}During Response:${color.reset}\\n`
    output += `  ${color.white}ESC${color.reset}             - Stop response streaming\\n`
    output += `  ${color.white}(preserved)${color.reset}     - Previous content preserved\\n\\n`
    
    output += `${color.blue}Input Shortcuts:${color.reset}\\n`
    output += `  ${color.white}(empty)${color.reset}         - Clear context history\\n`
    output += `  ${color.white}Up/Down${color.reset}        - Command history (in menus)\\n\\n`
    
    output += `${color.blue}Menu Navigation:${color.reset}\\n`
    output += `  ${color.white}1-9${color.reset}             - Select menu option\\n`
    output += `  ${color.white}ESC${color.reset}             - Cancel menu selection\\n`
    output += `  ${color.white}Enter${color.reset}          - Confirm selection\\n\\n`
    
    output += `${color.grey}ESC key provides immediate response cancellation.${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show usage examples help
   * @private
   * @returns {Promise<string>} Examples help content
   */
  async showExamplesHelp() {
    let output = `${color.cyan}Usage Examples:${color.reset}\\n\\n`
    
    output += `${color.blue}Basic Translation:${color.reset}\\n`
    output += `  ${color.white}> aa Hello world${color.reset}\\n`
    output += `  ${color.grey}  Multiple English variants provided${color.reset}\\n\\n`
    
    output += `  ${color.white}> rr How are you?${color.reset}\\n`
    output += `  ${color.grey}  Как дела?${color.reset}\\n\\n`
    
    output += `${color.blue}Chinese Learning:${color.reset}\\n`
    output += `  ${color.white}> hsk 你好${color.reset}\\n`
    output += `  ${color.grey}  English: hello\\n  Russian: привет\\n  Pinyin: nǐ hǎo${color.reset}\\n\\n`
    
    output += `  ${color.white}> hskss 学习${color.reset}\\n`
    output += `  ${color.grey}  Creates sentence: 我在学习中文\\n  + translations${color.reset}\\n\\n`
    
    output += `${color.blue}Web Content:${color.reset}\\n`
    output += `  ${color.white}> aa https://news.ycombinator.com${color.reset}\\n`
    output += `  ${color.grey}  Extracts and translates webpage content${color.reset}\\n\\n`
    
    output += `  ${color.white}> search artificial intelligence news${color.reset}\\n`
    output += `  ${color.grey}  Searches web and provides relevant results${color.reset}\\n\\n`
    
    output += `${color.blue}Advanced Usage:${color.reset}\\n`
    output += `  ${color.white}> gg $$ --force${color.reset}\\n`
    output += `  ${color.grey}  Grammar check clipboard, bypass cache${color.reset}\\n\\n`
    
    output += `  ${color.white}> provider openai${color.reset}\\n`
    output += `  ${color.white}> model gpt-4${color.reset}\\n`
    output += `  ${color.white}> aa Complex technical text${color.reset}\\n`
    output += `  ${color.grey}  High-quality translation with best model${color.reset}\\n\\n`
    
    output += `${color.grey}Combine features for powerful workflows!${color.reset}\\n`
    
    return output
  }
  
  /**
   * Show help for a specific command
   * @private
   * @param {string} commandName - Command name
   * @returns {Promise<string>} Command help content
   */
  async showCommandHelp(commandName) {
    // Try to find command in instruction database
    try {
      const instructions = getCommandsFromDB()
      
      for (const [id, instruction] of Object.entries(instructions)) {
        if (instruction.key.includes(commandName)) {
          let output = `${color.cyan}Command: ${commandName}${color.reset}\\n\\n`
          output += `${color.blue}Description:${color.reset} ${instruction.description}\\n`
          output += `${color.blue}Keys:${color.reset} ${instruction.key.join(', ')}\\n`
          output += `${color.blue}Usage:${color.reset} ${commandName} <text>\\n\\n`
          output += `${color.blue}Instruction:${color.reset}\\n${instruction.instruction}\\n\\n`
          
          if (instruction.models && instruction.models.length > 0) {
            output += `${color.blue}Specific Models:${color.reset}\\n`
            instruction.models.forEach(model => {
              output += `  • ${model.provider} - ${model.model}\\n`
            })
            output += `\\n`
          }
          
          return output
        }
      }
    } catch (error) {
      // Continue to other command sources
    }
    
    // Check system/AI commands
    let commandInfo = null
    
    if (this.systemCommands && this.systemCommands.hasCommand(commandName)) {
      commandInfo = this.systemCommands.getCommand(commandName)
    } else if (this.aiCommands && this.aiCommands.hasCommand(commandName)) {
      commandInfo = this.aiCommands.getCommand(commandName)
    }
    
    if (commandInfo) {
      let output = `${color.cyan}Command: ${commandName}${color.reset}\\n\\n`
      output += `${color.blue}Description:${color.reset} ${commandInfo.description}\\n`
      output += `${color.blue}Usage:${color.reset} ${commandInfo.usage}\\n`
      output += `${color.blue}Category:${color.reset} ${commandInfo.category}\\n`
      
      if (commandInfo.aliases && commandInfo.aliases.length > 0) {
        output += `${color.blue}Aliases:${color.reset} ${commandInfo.aliases.join(', ')}\\n`
      }
      
      return output
    }
    
    // Command not found
    return `${color.red}Command '${commandName}' not found.${color.reset}\\n\\n` +
           `${color.grey}Use 'help commands' to see all available commands.${color.reset}`
  }
  
  /**
   * Get help system statistics
   * @returns {Object} Help statistics
   */
  getHelpStats() {
    const mostRequestedSection = Object.entries(this.stats.sectionRequests)
      .reduce((a, b) => this.stats.sectionRequests[a[0]] > this.stats.sectionRequests[b[0]] ? a : b, ['none', 0])
    
    const mostRequestedCommand = Object.entries(this.stats.commandRequests)
      .reduce((a, b) => this.stats.commandRequests[a[0]] > this.stats.commandRequests[b[0]] ? a : b, ['none', 0])
    
    return {
      ...this.stats,
      mostRequestedSection: mostRequestedSection[0],
      mostRequestedCommand: mostRequestedCommand[0],
      totalSections: Object.keys(this.helpSections).length
    }
  }
  
  /**
   * Generate unique help request ID
   * @private
   * @returns {string} Help ID
   */
  generateHelpId() {
    return `help_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
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
      sections: this.helpSections,
      stats: this.getHelpStats()
    }
  }
}

/**
 * Create HelpCommand instance with dependencies
 * @param {Object} dependencies - Required dependencies
 * @returns {HelpCommand} HelpCommand instance
 */
export function createHelpCommand(dependencies = {}) {
  return new HelpCommand(dependencies)
}