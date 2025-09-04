/**
 * Router - Pure routing decisions only (DECISION ENGINE)
 * Determines request type and creates commandData - NO business logic execution
 */
import { logger } from '../utils/logger.js'
import { InputProcessingService } from '../services/input-processing-service.js'
import { systemCommandHandler } from './system-command-handler.js'
import { isSystemCommand } from '../config/system-commands.js'

export class Router {
  constructor(dependencies = {}) {
    // Initialize CommandProcessingService (Single Source of Truth for commands)
    this.commandProcessingService = dependencies.commandProcessingService || new InputProcessingService()
    
    // Handler dependencies (injected from app)
    this.systemCommandHandler = dependencies.systemCommandHandler || systemCommandHandler
    this.commandHandler = dependencies.commandHandler || null
    this.chatRequest = dependencies.chatRequest || null
    
    // Request types
    this.REQUEST_TYPES = {
      SYSTEM: 'system',
      INSTRUCTION: 'instruction',
      MCP_ENHANCED: 'mcp_enhanced',
      CHAT: 'chat'
    }
  }
  
  /**
   * Initialize the router
   */
  async initialize() {
    // Initialize CommandProcessingService
    await this.commandProcessingService.initialize()
    
    logger.debug('Router initialized - routing decisions only')
  }
  
  /**
   * Route and process user input - DECISION + EXECUTION (ONE PASS)
   */
  async routeAndProcess(input, applicationLoop) {
    try {
      // Single pass: analyze input and get all data needed (NO DUPLICATION)
      const analysis = await this.analyzeInput(input)
      
      // Execute based on analysis type
      return await this.executeFromAnalysis(analysis, applicationLoop)
      
    } catch (error) {
      logger.error('Route and process failed:', error)
      applicationLoop.writeError(`Error: ${error.message}`)
      return null
    }
  }
  
  /**
   * Execute command from analysis - SINGLE SOURCE OF TRUTH for data creation
   */
  async executeFromAnalysis(analysis, applicationLoop) {
    switch (analysis.type) {
      case this.REQUEST_TYPES.SYSTEM:
        return await this.systemCommandHandler.handle(analysis.rawInput, applicationLoop)
        
      case this.REQUEST_TYPES.INSTRUCTION:
        // Create data object - Single Source of Truth
        const instructionData = this.createData({
          content: analysis.instructionCommand.content,
          userInput: analysis.instructionCommand.userInput,
          instruction: analysis.instructionCommand.instruction,
          commandId: analysis.instructionCommand.id,
          models: analysis.instructionCommand.models || [],
          isCached: analysis.instructionCommand.isCached,
          isForced: analysis.flags.isForced
        })
        
        if (this.commandHandler) {
          return await this.commandHandler.handle(instructionData, applicationLoop.app)
        }
        // Fallback to direct ChatRequest
        return await this.chatRequest.processChatRequest(instructionData, applicationLoop)
        
      case this.REQUEST_TYPES.CHAT:
      default:
        // Create data object - Single Source of Truth
        const chatData = this.createData({
          content: analysis.rawInput,
          userInput: analysis.rawInput,
          models: [],
          isCached: false,
          isForced: analysis.flags.isForced
        })
        return await this.chatRequest.processChatRequest(chatData, applicationLoop)
    }
  }
  
  /**
   * Create standardized data object - Single Source of Truth
   */
  createData(options = {}) {
    return {
      content: options.content || '',
      userInput: options.userInput || options.content || '',
      instruction: options.instruction || null,
      commandId: options.commandId || null,
      models: options.models || [],
      isCached: options.isCached || false,
      isForced: options.isForced || false
    }
  }

  /**
   * Parse flags from input and return clean input + flags
   */
  parseFlags(input) {
    const words = input.split(/\s+/)
    const flags = { isForced: false }
    const cleanWords = []
    
    for (const word of words) {
      if (word === '--force' || word === '-f') {
        flags.isForced = true
      } else {
        cleanWords.push(word)
      }
    }
    
    return { 
      cleanInput: cleanWords.join(' '), 
      flags 
    }
  }

  /**
   * Analyze input in ONE PASS - get type + all command data (NO DUPLICATION!)
   */
  async analyzeInput(input) {
    const trimmedInput = input.trim()
    
    // Process clipboard markers FIRST (before any analysis)
    const processedInput = await this.commandProcessingService.processInput(trimmedInput)
    
    // Parse flags and get clean input (NOTE: --force flags are disabled with cache)
    const { cleanInput, flags } = this.parseFlags(processedInput)
    
    // 1. System commands first (PRIORITY)
    const commandName = cleanInput.split(' ')[0].toLowerCase()
    if (isSystemCommand(commandName)) {
      return {
        type: this.REQUEST_TYPES.SYSTEM,
        rawInput: cleanInput,
        commandName,
        flags: flags
      }
    }
    
    // 2. Instruction commands - ONE database search!
    const instructionCommand = await this.commandProcessingService.findInstructionCommand(cleanInput)
    if (instructionCommand && !instructionCommand.isInvalid) {
      return {
        type: this.REQUEST_TYPES.INSTRUCTION,
        rawInput: cleanInput,
        instructionCommand: instructionCommand,
        flags: flags
      }
    }
    
    // 3. MCP enhanced (URL detection)
    if (this.hasUrl(cleanInput)) {
      return {
        type: this.REQUEST_TYPES.MCP_ENHANCED,
        rawInput: cleanInput,
        flags: flags
      }
    }
    
    // 4. Default to chat
    return {
      type: this.REQUEST_TYPES.CHAT,
      rawInput: cleanInput,
      flags: flags
    }
  }
  
  
  
  /**
   * Get routing target based on command type - DECISION ONLY
   */
  getRoutingTarget(commandType, input) {
    switch (commandType) {
      case this.REQUEST_TYPES.SYSTEM:
        return 'system_command_handler'
        
      case this.REQUEST_TYPES.INSTRUCTION:
        return 'instruction_processor'
        
      case this.REQUEST_TYPES.MCP_ENHANCED:
        return 'mcp_processor'
        
      case this.REQUEST_TYPES.CHAT:
      default:
        return 'ai_processor'
    }
  }
  
  /**
   * Simple URL detection
   */
  hasUrl(str) {
    return str
      .split(' ')
      .filter(Boolean)
      .some(word => {
        try {
          new URL(word)
          return true
        } catch {
          return false
        }
      })
  }
  
  /**
   * Get routing statistics
   */
  getRoutingStats() {
    return {
      requestTypes: Object.values(this.REQUEST_TYPES),
      commandProcessingServiceReady: this.commandProcessingService.initialized
    }
  }
}

