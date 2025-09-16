import { logger } from '../utils/logger.js'
import { inputProcessingService } from '../services/input-processing/index.js'
import { systemCommandHandler } from './system-command-handler.js'
import { isSystemCommand } from '../utils/system-commands.js'
import { errorHandler } from './error-system/index.js'
import { outputHandler } from './print/index.js'

export const createRouter = (dependencies = {}) => {
  // Request types constants
  const REQUEST_TYPES = {
    SYSTEM: 'system',
    INSTRUCTION: 'instruction',
    INVALID: 'invalid',
    CHAT: 'chat'
  }

  // Handler functions mapped to request types (replaces switch/case)
  const executionHandlers = {
    [REQUEST_TYPES.SYSTEM]: async (analysis, applicationLoop, handlers) => {
      return await handlers.systemCommandHandler.handle(analysis.rawInput, applicationLoop)
    },

    [REQUEST_TYPES.INSTRUCTION]: async (analysis, applicationLoop, handlers) => {
      // Create data object - Single Source of Truth
      const instructionData = createData({
        content: analysis.instructionCommand.content,
        userInput: analysis.instructionCommand.userInput,
        instruction: analysis.instructionCommand.instruction,
        commandId: analysis.instructionCommand.id,
        models: analysis.instructionCommand.models || []
      })

      // Route based on model count (moved from CommandHandler)
      if (instructionData.models.length > 1) {
        logger.debug('Router: Routing to MultiModelCommand')
        return await handlers.multiModelCommand.execute(instructionData, applicationLoop.app)
      } else {
        logger.debug('Router: Routing to SingleModelCommand')
        return await handlers.singleModelCommand.execute(instructionData)
      }
    },

    [REQUEST_TYPES.INVALID]: async (analysis) => {
      outputHandler.writeError(analysis.error)
      return null
    },

    [REQUEST_TYPES.CHAT]: async (analysis, applicationLoop, handlers) => {
      logger.debug('Router: Routing to ChatHandler')
      return await handlers.chatHandler.handle(analysis.rawInput)
    }
  }

  // State encapsulation through closures
  const state = {
    commandProcessingService: dependencies.commandProcessingService || inputProcessingService,
    systemCommandHandler: dependencies.systemCommandHandler || systemCommandHandler,
    multiModelCommand: dependencies.multiModelCommand || null,
    singleModelCommand: dependencies.singleModelCommand || null,
    chatHandler: dependencies.chatHandler || null
  }

  const initialize = async () => {
    // Initialize CommandProcessingService
    await state.commandProcessingService.initialize()
    logger.debug('Router initialized - routing decisions only')
  }

  const routeAndProcess = async (input, applicationLoop) => {
    try {
      // Single pass: analyze input and get all data needed (NO DUPLICATION)
      const analysis = await analyzeInput(input)

      // Execute based on analysis type using functional handlers
      return await executeFromAnalysis(analysis, applicationLoop)

    } catch (error) {
      await errorHandler.handleError(error, { context: 'Router:routeAndProcess' })
      return null
    }
  }

  const executeFromAnalysis = async (analysis, applicationLoop) => {
    const handler = executionHandlers[analysis.type] || executionHandlers[REQUEST_TYPES.CHAT]
    return await handler(analysis, applicationLoop, state)
  }

  const createData = (options = {}) => {
    return {
      content: options.content || '',
      userInput: options.userInput || options.content || '',
      instruction: options.instruction || null,
      commandId: options.commandId || null,
      models: options.models || []
    }
  }

  const analyzeInput = async (input) => {
    const trimmedInput = input.trim()

    // Process clipboard markers FIRST (before any analysis)
    const cleanInput = await state.commandProcessingService.processInput(trimmedInput)

    // 1. System commands first (PRIORITY)
    const commandName = cleanInput.split(' ')[0].toLowerCase()
    if (isSystemCommand(commandName)) {
      return {
        type: REQUEST_TYPES.SYSTEM,
        rawInput: cleanInput,
        commandName
      }
    }

    // 2. Instruction commands - ONE database search!
    const instructionCommand = await state.commandProcessingService.findInstructionCommand(cleanInput)

    if (instructionCommand) {
      // Check for invalid commands first
      if (instructionCommand.isInvalid) {
        return {
          type: REQUEST_TYPES.INVALID,
          rawInput: cleanInput,
          error: instructionCommand.error
        }
      }

      return {
        type: REQUEST_TYPES.INSTRUCTION,
        rawInput: cleanInput,
        instructionCommand: instructionCommand
      }
    }

    // 3. Default to chat
    return {
      type: REQUEST_TYPES.CHAT,
      rawInput: cleanInput
    }
  }

  return {
    initialize,
    routeAndProcess,
    analyzeInput
  }
}
