/**
 * RequestRouter - Centralized request routing and classification
 * Handles command detection, input processing, and request routing
 */
import { APP_CONSTANTS } from '../config/constants.js'
import { getClipboardContent } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { getCommandsFromDB } from '../utils/database-manager.js'
import { color } from '../config/color.js'

export class RequestRouter {
  constructor(stateManager, cliInterface, dependencies = {}) {
    this.stateManager = stateManager
    this.cliInterface = cliInterface
    
    // Inject dependencies
    this.intentDetector = dependencies.intentDetector
    this.mcpManager = dependencies.mcpManager
    this.commandHandler = dependencies.commandHandler
    this.cache = dependencies.cache
    this.multiProviderTranslator = dependencies.multiProviderTranslator
    this.multiCommandProcessor = dependencies.multiCommandProcessor
    
    // Request types
    this.REQUEST_TYPES = {
      SYSTEM: 'system',
      AI_COMMAND: 'ai_command', 
      INSTRUCTION: 'instruction',
      TRANSLATION: 'translation',
      MULTI_PROVIDER: 'multi_provider',
      MULTI_MODEL: 'multi_model',
      MCP_ENHANCED: 'mcp_enhanced',
      CHAT: 'chat'
    }
    
    // Force flags for bypassing cache
    this.forceFlags = APP_CONSTANTS.FORCE_FLAGS || [' --force', ' -f']
    
    // Instructions database cache
    this.instructionsDatabase = null
    this.lastInstructionsLoad = 0
    this.instructionsCacheTimeout = 30000 // 30 seconds
  }
  
  /**
   * Initialize the router
   */
  async initialize() {
    await this.refreshInstructionsDatabase()
  }
  
  /**
   * Route and process user input
   * @param {string} input - Raw user input
   * @returns {Promise<Object>} Routing result
   */
  async routeRequest(input) {
    const routingContext = {
      originalInput: input,
      processedInput: input,
      requestType: null,
      command: null,
      metadata: {},
      forceRequest: false,
      needsProcessing: true
    }
    
    try {
      // Step 1: Process input transformations
      await this.processInputTransformations(routingContext)
      
      // Step 2: Detect and classify request
      await this.classifyRequest(routingContext)
      
      // Step 3: Apply routing logic
      const result = await this.applyRouting(routingContext)
      
      return {
        success: true,
        ...result,
        context: routingContext
      }
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        context: routingContext
      }
    }
  }
  
  /**
   * Process input transformations (clipboard, flags)
   * @private
   * @param {Object} routingContext - Routing context
   */
  async processInputTransformations(routingContext) {
    let { processedInput } = routingContext
    
    // 1. Handle clipboard content
    if (processedInput.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      const clipboardContent = await this.handleClipboardReplacement(processedInput)
      processedInput = clipboardContent
      routingContext.metadata.clipboardUsed = true
    }
    
    // 2. Extract force flags
    const { cleanInput, forceDetected } = this.extractForceFlags(processedInput)
    processedInput = cleanInput
    routingContext.forceRequest = forceDetected
    
    routingContext.processedInput = processedInput
  }
  
  /**
   * Classify the request type
   * @private
   * @param {Object} routingContext - Routing context
   */
  async classifyRequest(routingContext) {
    const { processedInput } = routingContext
    
    // 1. Check for system/AI commands first
    if (this.commandHandler) {
      const commandResult = await this.checkSystemCommands(processedInput)
      if (commandResult.isCommand) {
        routingContext.requestType = commandResult.type
        routingContext.command = commandResult
        return
      }
    }
    
    // 2. Check for instruction commands
    const instructionCommand = await this.findInstructionCommand(processedInput)
    if (instructionCommand) {
      routingContext.command = instructionCommand
      
      // Classify instruction type
      if (instructionCommand.isTranslation) {
        routingContext.requestType = this.REQUEST_TYPES.TRANSLATION
      } else if (instructionCommand.isMultiProvider) {
        routingContext.requestType = this.REQUEST_TYPES.MULTI_PROVIDER
      } else if (instructionCommand.isMultiModel) {
        routingContext.requestType = this.REQUEST_TYPES.MULTI_MODEL
      } else {
        routingContext.requestType = this.REQUEST_TYPES.INSTRUCTION
      }
      
      return
    }
    
    // 3. Check if MCP processing is needed
    if (this.intentDetector) {
      const intentResult = await this.checkMCPIntent(processedInput)
      if (intentResult.needsMCP) {
        routingContext.requestType = this.REQUEST_TYPES.MCP_ENHANCED
        routingContext.metadata.mcpIntent = intentResult
        return
      }
    }
    
    // 4. Default to chat
    routingContext.requestType = this.REQUEST_TYPES.CHAT
  }
  
  /**
   * Apply routing logic based on request type
   * @private
   * @param {Object} routingContext - Routing context
   */
  async applyRouting(routingContext) {
    const { requestType, command, processedInput } = routingContext
    
    switch (requestType) {
      case this.REQUEST_TYPES.SYSTEM:
      case this.REQUEST_TYPES.AI_COMMAND:
        return await this.routeSystemCommand(routingContext)
        
      case this.REQUEST_TYPES.TRANSLATION:
        return await this.routeTranslationCommand(routingContext)
        
      case this.REQUEST_TYPES.MULTI_PROVIDER:
        return await this.routeMultiProviderCommand(routingContext)
        
      case this.REQUEST_TYPES.MULTI_MODEL:
        return await this.routeMultiModelCommand(routingContext)
        
      case this.REQUEST_TYPES.MCP_ENHANCED:
        return await this.routeMCPEnhancedRequest(routingContext)
        
      case this.REQUEST_TYPES.INSTRUCTION:
        return await this.routeInstructionCommand(routingContext)
        
      case this.REQUEST_TYPES.CHAT:
      default:
        return await this.routeChatRequest(routingContext)
    }
  }
  
  /**
   * Handle clipboard content replacement
   * @private
   * @param {string} input - Input with clipboard marker
   * @returns {Promise<string>} Input with clipboard content
   */
  async handleClipboardReplacement(input) {
    try {
      const buffer = await getClipboardContent()
      const sanitizedBuffer = sanitizeString(buffer)
      validateString(sanitizedBuffer, 'clipboard content', false)
      
      const maxLength = configManager.get('maxInputLength')
      if (sanitizedBuffer.length > maxLength) {
        throw new Error(`Clipboard content too large (max ${maxLength} characters)`)
      }
      
      const processedInput = input.replace(
        new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\\$/g, '\\\\$'), 'g'), 
        sanitizedBuffer
      )
      
      this.cliInterface.writeInfo(`[Clipboard content inserted (${sanitizedBuffer.length} chars)]`)
      
      return processedInput
      
    } catch (error) {
      throw new Error(`Clipboard processing failed: ${error.message}`)
    }
  }
  
  /**
   * Extract force flags from input
   * @private
   * @param {string} input - Input string
   * @returns {Object} Clean input and force flag detection
   */
  extractForceFlags(input) {
    let cleanInput = input
    let forceDetected = false
    
    for (const flag of this.forceFlags) {
      if (input.endsWith(flag)) {
        forceDetected = true
        const escapedFlag = flag.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')
        cleanInput = input.replace(new RegExp(escapedFlag + '$'), '').trim()
        break
      }
    }
    
    return { cleanInput, forceDetected }
  }
  
  /**
   * Check for system/AI commands
   * @private
   * @param {string} input - Input string
   * @returns {Promise<Object>} Command check result
   */
  async checkSystemCommands(input) {
    const trimmedInput = input.trim().toLowerCase()
    const words = trimmedInput.split(' ')
    const commandName = words[0]
    
    // Built-in system commands
    const systemCommands = ['help', 'h', 'exit', 'q']
    const aiCommands = ['provider', 'p', 'model', 'm']
    
    if (systemCommands.includes(commandName)) {
      return {
        isCommand: true,
        type: this.REQUEST_TYPES.SYSTEM,
        commandName,
        args: words.slice(1),
        result: null
      }
    }
    
    if (aiCommands.includes(commandName)) {
      return {
        isCommand: true,
        type: this.REQUEST_TYPES.AI_COMMAND,
        commandName,
        args: words.slice(1),
        result: null
      }
    }
    
    // Legacy commandHandler support
    if (this.commandHandler) {
      try {
        const context = { input }
        const canHandle = await this.commandHandler.canHandle(context)
        
        if (canHandle) {
          const result = await this.commandHandler.handle(context)
          return {
            isCommand: true,
            type: result.type === 'system' ? this.REQUEST_TYPES.SYSTEM : this.REQUEST_TYPES.AI_COMMAND,
            result,
            handled: result.handled
          }
        }
      } catch (error) {
        console.warn('Legacy command handler failed:', error.message)
      }
    }
    
    return { isCommand: false }
  }
  
  /**
   * Find instruction command from database
   * @private
   * @param {string} input - Input string
   * @returns {Promise<Object|null>} Instruction command or null
   */
  async findInstructionCommand(input) {
    // Refresh instructions if needed
    if (Date.now() - this.lastInstructionsLoad > this.instructionsCacheTimeout) {
      await this.refreshInstructionsDatabase()
    }
    
    if (!this.instructionsDatabase) {
      return null
    }
    
    const words = input.trim().split(' ')
    const commandKey = words[0]
    const targetContent = words.slice(1).join(' ')
    
    for (const [id, instruction] of Object.entries(this.instructionsDatabase)) {
      if (instruction.key && instruction.key.includes(commandKey)) {
        if (targetContent) {
          return {
            id,
            commandKey,
            instruction: instruction.instruction,
            fullInstruction: `${instruction.instruction}: ${targetContent}`,
            targetContent,
            originalInput: input,
            isTranslation: this.isTranslationCommand(id),
            isMultiProvider: this.isMultiProviderCommand(instruction),
            isMultiModel: this.isMultiModelCommand(instruction),
            hasUrl: /https?:\/\//.test(targetContent),
            models: instruction.models || null
          }
        }
      }
    }
    
    return null
  }
  
  /**
   * Check if MCP processing is needed
   * @private
   * @param {string} input - Input string
   * @returns {Promise<Object>} MCP intent result
   */
  async checkMCPIntent(input) {
    if (!this.intentDetector) {
      return { needsMCP: false }
    }
    
    try {
      const intent = await this.intentDetector.detectIntent(input)
      return {
        needsMCP: intent.confidence > 0.7,
        intent
      }
    } catch (error) {
      return { needsMCP: false, error: error.message }
    }
  }
  
  /**
   * Route system command
   * @private
   */
  async routeSystemCommand(routingContext) {
    const { command } = routingContext
    
    // Generate help content for help commands
    if (command.commandName === 'help' || command.commandName === 'h') {
      const helpContent = await this.generateHelpContent()
      return {
        action: 'return_direct_response',
        result: helpContent,
        needsAIProcessing: false
      }
    }
    
    return {
      action: 'execute_system_command',
      result: command.result,
      needsAIProcessing: false
    }
  }
  
  /**
   * Route translation command
   * @private
   */
  async routeTranslationCommand(routingContext) {
    const { command, forceRequest } = routingContext
    
    // Check cache first (unless forced)
    if (!forceRequest && this.cache) {
      const cacheKey = command.hasUrl ? command.originalInput : command.fullInstruction
      const cached = this.cache.get(cacheKey)
      
      if (cached) {
        this.cliInterface.writeWarning('[from cache]')
        return {
          action: 'return_cached_result',
          result: cached,
          needsAIProcessing: false
        }
      }
    }
    
    // Handle URL translations through MCP
    if (command.hasUrl) {
      return await this.routeMCPTranslation(routingContext)
    }
    
    // Regular translation
    return {
      action: 'process_translation',
      input: command.fullInstruction,
      command,
      needsAIProcessing: true
    }
  }
  
  /**
   * Route multi-provider command
   * @private
   */
  async routeMultiProviderCommand(routingContext) {
    const { command, forceRequest } = routingContext
    
    if (!this.multiProviderTranslator) {
      throw new Error('Multi-provider translator not available')
    }
    
    // Check cache
    if (!forceRequest && this.cache) {
      const cacheKey = command.originalInput
      if (this.cache.hasMultipleResponses(cacheKey)) {
        const cachedResponses = this.cache.getMultipleResponses(cacheKey)
        const formattedResponse = this.multiProviderTranslator.formatMultiProviderResponse({
          translations: cachedResponses.map(r => ({ ...r, emoji: undefined })),
          elapsed: 0,
          successful: cachedResponses.filter(r => r.response && !r.error).length,
          total: cachedResponses.length
        })
        
        this.cliInterface.writeWarning('[from cache]')
        return {
          action: 'return_formatted_result',
          result: formattedResponse,
          needsAIProcessing: false
        }
      }
    }
    
    return {
      action: 'process_multi_provider',
      command,
      needsAIProcessing: false // Handled by multi-provider translator
    }
  }
  
  /**
   * Route multi-model command
   * @private
   */
  async routeMultiModelCommand(routingContext) {
    if (!this.multiCommandProcessor) {
      throw new Error('Multi-command processor not available')
    }
    
    return {
      action: 'process_multi_model',
      command: routingContext.command,
      needsAIProcessing: false // Handled by multi-command processor
    }
  }
  
  /**
   * Route MCP enhanced request
   * @private
   */
  async routeMCPEnhancedRequest(routingContext) {
    const mcpResult = await this.processMCPEnhancement(routingContext)
    
    if (mcpResult.directResponse) {
      return {
        action: 'return_direct_response',
        result: mcpResult.directResponse,
        needsAIProcessing: false
      }
    }
    
    return {
      action: 'process_enhanced_input',
      input: mcpResult.enhancedInput,
      metadata: mcpResult.metadata,
      needsAIProcessing: true
    }
  }
  
  /**
   * Route instruction command
   * @private
   */
  async routeInstructionCommand(routingContext) {
    return {
      action: 'process_instruction',
      input: routingContext.command.fullInstruction,
      command: routingContext.command,
      needsAIProcessing: true
    }
  }
  
  /**
   * Route chat request
   * @private
   */
  async routeChatRequest(routingContext) {
    return {
      action: 'process_chat',
      input: routingContext.processedInput,
      needsAIProcessing: true
    }
  }
  
  /**
   * Process MCP enhancement
   * @private
   */
  async processMCPEnhancement(routingContext) {
    // This would integrate with MCP manager
    // Placeholder implementation
    return {
      enhancedInput: routingContext.processedInput,
      metadata: routingContext.metadata.mcpIntent
    }
  }
  
  /**
   * Route MCP-enhanced translation
   * @private
   */
  async routeMCPTranslation(routingContext) {
    // This would handle URL translation through MCP
    // Placeholder implementation
    return {
      action: 'process_mcp_translation',
      command: routingContext.command,
      needsAIProcessing: true
    }
  }
  
  /**
   * Refresh instructions database
   * @private
   */
  async refreshInstructionsDatabase() {
    try {
      this.instructionsDatabase = getCommandsFromDB()
      this.lastInstructionsLoad = Date.now()
      console.log(`${color.grey}[DEBUG] Loaded ${Object.keys(this.instructionsDatabase).length} commands from database${color.reset}`)
    } catch (error) {
      console.warn('Failed to load instructions database:', error.message)
      this.instructionsDatabase = {}
    }
  }
  
  /**
   * Generate help content
   * @private
   */
  async generateHelpContent() {
    await this.refreshInstructionsDatabase()
    
    let helpText = `${color.cyan}Available commands:${color.reset}\n\n`
    
    // System commands
    helpText += `${color.yellow}System Commands:${color.reset}\n`
    helpText += `  help, h      - Show this help message\n`
    helpText += `  provider, p  - Switch AI provider\n`
    helpText += `  model, m     - Switch AI model\n`
    helpText += `  exit, q      - Exit application\n\n`
    
    // Database commands
    if (this.instructionsDatabase && Object.keys(this.instructionsDatabase).length > 0) {
      helpText += `${color.yellow}Instruction Commands:${color.reset}\n`
      
      for (const [id, instruction] of Object.entries(this.instructionsDatabase)) {
        if (instruction.key) {
          helpText += `  ${instruction.key.padEnd(12)} - ${instruction.instruction.substring(0, 60)}${instruction.instruction.length > 60 ? '...' : ''}\n`
        }
      }
      helpText += '\n'
    }
    
    helpText += `${color.green}Usage Examples:${color.reset}\n`
    helpText += `  en hello world       - Translate to English\n`
    helpText += `  provider            - Switch AI provider\n`
    helpText += `  What is JavaScript?  - Ask a question\n`
    
    return helpText
  }

  /**
   * Check if command is translation-related
   * @private
   */
  isTranslationCommand(commandId) {
    const translationCommands = ['RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS']
    return translationCommands.includes(commandId)
  }
  
  /**
   * Check if command should use multiple providers
   * @private
   */
  isMultiProviderCommand(instruction) {
    return instruction.multiProvider === true
  }
  
  /**
   * Check if command should use multiple models
   * @private
   */
  isMultiModelCommand(instruction) {
    return instruction.models && Array.isArray(instruction.models) && instruction.models.length > 1
  }
  
  /**
   * Process AI Input - Core business logic from bin/app.js
   * @param {string} input - User input
   * @param {Object} dependencies - Required dependencies (serviceManager, cliInterface, etc.)
   * @returns {Promise<void>}
   */
  async processAIInput(input, dependencies) {
    const { serviceManager, cliInterface, cache, mcpManager, intentDetector, 
            multiProviderTranslator, StreamProcessor, configManager } = dependencies
    
    let interval
    let startTime
    const originalInput = input
    
    // Create abort controller for cancellation
    const currentRequestController = new AbortController()
    this.stateManager.setCurrentRequestController(currentRequestController)
    this.stateManager.setProcessingRequest(true)
    
    try {
      // Step 1: Route the request
      const routingResult = await this.routeRequest(input)
      
      if (!routingResult.success) {
        throw new Error(routingResult.error)
      }
      
      const { action, needsAIProcessing } = routingResult
      
      // Step 2: Handle non-AI processing actions
      if (!needsAIProcessing) {
        switch (action) {
          case 'return_cached_result':
          case 'return_formatted_result':
          case 'return_direct_response':
            cliInterface.writeOutput(routingResult.result)
            return
          case 'process_multi_provider':
            await this.handleMultiProviderProcessing(routingResult, dependencies)
            return
          case 'process_multi_model':
            await this.handleMultiModelProcessing(routingResult, dependencies)
            return
        }
      }
      
      // Step 3: AI Processing required
      const { input: processedInput, command } = routingResult
      const finalInput = processedInput || input
      
      // Create cache key
      const cacheKey = command?.originalInput || finalInput
      
      // Check cache for commands with caching enabled
      if (command?.cache_enabled && !routingResult.context.forceRequest && cache.has(cacheKey)) {
        cliInterface.writeWarning('[from cache]')
        cliInterface.writeOutput(cache.get(cacheKey))
        return
      }
      
      // Execute AI processing
      await this.executeAIProcessing(finalInput, command, {
        ...dependencies,
        currentRequestController,
        cacheKey
      })
      
    } catch (error) {
      this.stateManager.setProcessingRequest(false)
      throw error
    }
  }
  
  /**
   * Execute AI Processing with streaming support
   * @param {string} input - Processed input
   * @param {Object} command - Command context
   * @param {Object} dependencies - All required dependencies
   */
  async executeAIProcessing(input, command, dependencies) {
    const { serviceManager, cliInterface, cache, StreamProcessor, 
            currentRequestController, cacheKey, configManager } = dependencies
    
    const startTime = Date.now()
    
    try {
      // Get AI state
      const aiState = this.stateManager.getAIState()
      
      // Prepare messages
      let messages = []
      if (command?.isTranslation) {
        messages = [{ role: 'user', content: input }]
      } else {
        const contextHistory = this.stateManager.getContextHistory()
        messages = contextHistory.map(({ role, content }) => ({ role, content }))
        messages.push({ role: 'user', content: input })
      }
      
      // Start spinner
      let i = 0
      const spinnerInterval = setInterval(() => {
        if (currentRequestController.signal.aborted) {
          clearInterval(spinnerInterval)
          return
        }
        
        cliInterface.clearLine()
        const elapsed = (Date.now() - startTime) / 1000
        const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
        process.stdout.write(`${spinnerChars[i++ % spinnerChars.length]} ${elapsed.toFixed(1)}s`)
      }, configManager.get('spinnerInterval') || 100)
      
      this.stateManager.setSpinnerInterval(spinnerInterval)
      
      // Create chat completion
      const stream = await aiState.provider.createChatCompletion(aiState.model, messages, {
        stream: true,
        signal: currentRequestController.signal
      })
      
      // Process streaming response
      const streamProcessor = new StreamProcessor(aiState.selectedProviderKey)
      
      const response = await cliInterface.processStreamingResponse(
        stream, 
        streamProcessor, 
        currentRequestController,
        null
      )
      
      // Clear spinner
      clearInterval(spinnerInterval)
      this.stateManager.setSpinnerInterval(null)
      
      // Handle response
      if (!currentRequestController.signal.aborted && !this.stateManager.shouldReturnToPrompt()) {
        const fullResponse = response.join('')
        
        if (command?.cache_enabled) {
          // Cache response for commands with caching enabled
          await cache.set(cacheKey, fullResponse)
        } else {
          // Add to context history
          this.stateManager.addToContext('user', input)
          this.stateManager.addToContext('assistant', fullResponse)
          
          // Trim context if needed
          const maxHistory = configManager.get('maxContextHistory') || 10
          const contextHistory = this.stateManager.getContextHistory()
          if (contextHistory.length > maxHistory) {
            this.stateManager.setContextHistory(contextHistory.slice(-maxHistory))
          }
          
          // Show context dots
          cliInterface.showContextHistory(contextHistory.length)
        }
      }
      
    } catch (error) {
      // Handle cancellation gracefully
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        const elapsed = (Date.now() - startTime) / 1000
        cliInterface.showStatus('error', elapsed)
        return
      }
      
      throw error
    } finally {
      // Cleanup
      const spinnerInterval = this.stateManager.getSpinnerInterval()
      if (spinnerInterval) {
        clearInterval(spinnerInterval)
        this.stateManager.setSpinnerInterval(null)
      }
      
      this.stateManager.setProcessingRequest(false)
      this.stateManager.setCurrentRequestController(null)
    }
  }
  
  /**
   * Handle multi-provider processing
   * @private
   */
  async handleMultiProviderProcessing(routingResult, dependencies) {
    const { multiProviderTranslator, currentRequestController } = dependencies
    const { command } = routingResult
    
    try {
      const result = await multiProviderTranslator.translateMultiple(
        command.id,
        command.instruction,
        command.targetContent,
        currentRequestController?.signal,
        command.models
      )
      
      const formattedResponse = multiProviderTranslator.formatMultiProviderResponse(result)
      dependencies.cliInterface.writeOutput(formattedResponse)
      
      // Cache result
      if (dependencies.cache) {
        await dependencies.cache.setMultipleResponses(command.originalInput, result.translations)
      }
      
    } catch (error) {
      throw new Error(`Multi-provider processing failed: ${error.message}`)
    }
  }
  
  /**
   * Handle multi-model processing
   * @private
   */
  async handleMultiModelProcessing(routingResult, dependencies) {
    const { multiCommandProcessor } = dependencies
    const { command } = routingResult
    
    try {
      await multiCommandProcessor.executeMultiple(command)
    } catch (error) {
      throw new Error(`Multi-model processing failed: ${error.message}`)
    }
  }
  
  /**
   * Process MCP input for URL and search enhancement
   * @param {string} input - User input
   * @param {Object} command - Command context
   * @param {Object} dependencies - MCP dependencies
   * @returns {Promise<Object>} MCP processing result
   */
  async processMCPInput(input, command, dependencies) {
    const { mcpManager, intentDetector } = dependencies
    
    // Check if MCP processing is needed
    const needsMCP = command?.hasUrl || (intentDetector && await intentDetector.requiresMCP(input))
    
    if (!needsMCP) {
      return null
    }
    
    try {
      // Determine MCP routing
      let routing
      if (command?.hasUrl) {
        routing = { server: 'fetch', tool: 'fetch_url', confidence: 1.0 }
      } else {
        routing = await intentDetector.getMCPRouting(input)
      }
      
      // Execute MCP request
      const mcpResult = await mcpManager.executeRequest(routing.server, routing.tool, {
        input: command?.targetContent || input
      })
      
      if (mcpResult && mcpResult.success) {
        return {
          enhancedInput: `${input}\\n\\nContent: ${mcpResult.data.content}`,
          mcpData: mcpResult.data,
          showMCPData: true
        }
      }
      
      return null
      
    } catch (error) {
      console.warn(`MCP processing failed: ${error.message}`)
      return null
    }
  }

  /**
   * Get routing statistics
   * @returns {Object} Routing statistics
   */
  getRoutingStats() {
    return {
      instructionsLoaded: this.instructionsDatabase ? Object.keys(this.instructionsDatabase).length : 0,
      lastInstructionsLoad: new Date(this.lastInstructionsLoad),
      requestTypes: Object.values(this.REQUEST_TYPES),
      forceFlags: this.forceFlags
    }
  }
}

/**
 * Create and return RequestRouter instance
 */
export function createRequestRouter(stateManager, cliInterface, dependencies = {}) {
  return new RequestRouter(stateManager, cliInterface, dependencies)
}