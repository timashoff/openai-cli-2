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
    CHAT: 'chat',
    AGENT: 'agent',
  }

  // Handler functions mapped to request types (replaces switch/case)
  const executionHandlers = {
    [REQUEST_TYPES.SYSTEM]: async (analysis, applicationLoop, handlers) => {
      return await handlers.systemCommandHandler.handle(analysis.rawInput, applicationLoop)
    },

    [REQUEST_TYPES.INSTRUCTION]: async (analysis, applicationLoop, handlers) => {
      if (
        analysis.instructionCommand &&
        analysis.instructionCommand.executionMode === REQUEST_TYPES.AGENT &&
        (!Array.isArray(analysis.instructionCommand.models) ||
          analysis.instructionCommand.models.length <= 1)
      ) {
        logger.debug('Router: Routing to ResponsesAgentCommand (executionMode=agent)')

        const stateManager = applicationLoop.app.stateManager
        const profileId = analysis.instructionCommand.agentProfileId
        const profile = await stateManager.getAgentProfile(profileId)

        if (!profile) {
          outputHandler.writeError(
            `Agent profile "${profileId}" not found. Use cmd to configure profiles.`,
          )
          return null
        }

        if (!handlers.responsesAgentCommand) {
          throw new Error('Router: Agent command handler not configured')
        }

        return await handlers.responsesAgentCommand.execute({
          profile,
          userInput: analysis.instructionCommand.userInput,
        })
      }

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
    },

    [REQUEST_TYPES.AGENT]: async (analysis, applicationLoop, handlers) => {
      const stateManager = applicationLoop.app.stateManager
      const agentCommand = analysis.agentCommand || analysis.instructionCommand

      if (!agentCommand) {
        throw new Error('Router: Agent command payload missing')
      }

      const profileId = agentCommand.agentProfileId || agentCommand.profileId
      const profile = agentCommand.profile || (await stateManager.getAgentProfile(profileId))

      if (!profile) {
        outputHandler.writeError(
          `Agent profile "${profileId}" not found. Use cmd to configure profiles.`,
        )
        return null
      }

      if (!handlers.responsesAgentCommand) {
        throw new Error('Router: Agent command handler not configured')
      }

      return await handlers.responsesAgentCommand.execute({
        profile,
        userInput: agentCommand.userInput || agentCommand.content || '',
      })
    },
  }

  // State encapsulation through closures
  const state = {
    commandProcessingService: dependencies.commandProcessingService || inputProcessingService,
    systemCommandHandler: dependencies.systemCommandHandler || systemCommandHandler,
    multiModelCommand: dependencies.multiModelCommand || null,
    singleModelCommand: dependencies.singleModelCommand || null,
    chatHandler: dependencies.chatHandler || null,
    responsesAgentCommand: dependencies.responsesAgentCommand || null,
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

      const executionMode = instructionCommand.executionMode || REQUEST_TYPES.INSTRUCTION
      const isAgentCommand = executionMode === REQUEST_TYPES.AGENT
      const hasMultipleModels = Array.isArray(instructionCommand.models) && instructionCommand.models.length > 1
      const requestType =
        isAgentCommand && !hasMultipleModels
          ? REQUEST_TYPES.AGENT
          : REQUEST_TYPES.INSTRUCTION

      const analysisResult = {
        type: requestType,
        rawInput: cleanInput,
        instructionCommand,
      }

      if (requestType === REQUEST_TYPES.AGENT) {
        analysisResult.agentCommand = {
          id: instructionCommand.id,
          agentProfileId: instructionCommand.agentProfileId,
          userInput: instructionCommand.userInput,
          profile: instructionCommand.profile,
        }
      }

      return analysisResult
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
