/**
 * Router - Pure routing decisions only (DECISION ENGINE)
 * Determines request type and creates commandData - NO business logic execution
 */
import { logger } from '../utils/logger.js'
import { inputProcessingService } from '../services/input-processing/index.js'
import { systemCommandHandler } from './system-command-handler.js'
import { isSystemCommand } from '../utils/system-commands.js'
import { logError, processError, errorHandler } from './error-system/index.js'
import { outputHandler } from './print/output.js'

export class Router {
  constructor(dependencies = {}) {
    // Use singleton InputProcessingService (Single Source of Truth for commands)
    this.commandProcessingService = dependencies.commandProcessingService || inputProcessingService

    // Handler dependencies (injected from app)
    this.systemCommandHandler = dependencies.systemCommandHandler || systemCommandHandler
    this.multiModelCommand = dependencies.multiModelCommand || null
    this.singleModelCommand = dependencies.singleModelCommand || null
    this.chatHandler = dependencies.chatHandler || null

    // Request types
    this.REQUEST_TYPES = {
      SYSTEM: 'system',
      INSTRUCTION: 'instruction',
      INVALID: 'invalid',
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
      await errorHandler.handleError(error, { context: 'Router:routeAndProcess' })
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
          models: analysis.instructionCommand.models || []
        })

        // Route based on model count (moved from CommandHandler)
        if (instructionData.models.length > 1) {
          logger.debug('Router: Routing to MultiModelCommand')
          return await this.multiModelCommand.execute(instructionData, applicationLoop.app)
        } else {
          logger.debug('Router: Routing to SingleModelCommand')
          return await this.singleModelCommand.execute(instructionData)
        }

      case this.REQUEST_TYPES.INVALID:
        outputHandler.writeError(analysis.error)
        return null

      case this.REQUEST_TYPES.CHAT:
      default:
        logger.debug('Router: Routing to ChatHandler')
        return await this.chatHandler.handle(analysis.rawInput)
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
      models: options.models || []
    }
  }


  /**
   * Analyze input in ONE PASS - get type + all command data (NO DUPLICATION!)
   */
  async analyzeInput(input) {
    const trimmedInput = input.trim()

    // Process clipboard markers FIRST (before any analysis)
    const cleanInput = await this.commandProcessingService.processInput(trimmedInput)

    // 1. System commands first (PRIORITY)
    const commandName = cleanInput.split(' ')[0].toLowerCase()
    if (isSystemCommand(commandName)) {
      return {
        type: this.REQUEST_TYPES.SYSTEM,
        rawInput: cleanInput,
        commandName
      }
    }

    // 2. Instruction commands - ONE database search!
    const instructionCommand = await this.commandProcessingService.findInstructionCommand(cleanInput)
    
    if (instructionCommand) {
      // Check for invalid commands first
      if (instructionCommand.isInvalid) {
        return {
          type: this.REQUEST_TYPES.INVALID,
          rawInput: cleanInput,
          error: instructionCommand.error
        }
      }
      
      return {
        type: this.REQUEST_TYPES.INSTRUCTION,
        rawInput: cleanInput,
        instructionCommand: instructionCommand
      }
    }

    // 3. Default to chat
    return {
      type: this.REQUEST_TYPES.CHAT,
      rawInput: cleanInput
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

      case this.REQUEST_TYPES.CHAT:
      default:
        return 'ai_processor'
    }
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
