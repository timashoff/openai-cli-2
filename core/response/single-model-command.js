import { logger } from '../../utils/logger.js'
import { createSpinner } from '../../utils/spinner.js'
import { errorHandler } from '../error-system/index.js'
import { outputHandler } from '../print/index.js'
import { prepareStreamingMessages } from '../../utils/message-utils.js'
import { updateContext } from '../../utils/context-utils.js'
import { createResponseSessionFactory } from './session.js'

export function createSingleModelCommand(app) {
  const sessionFactory = createResponseSessionFactory({ stateManager: app.stateManager })

  function extractProviderModel(modelEntry) {
    if (modelEntry.model) {
      return {
        provider: modelEntry.provider,
        model: modelEntry.model,
      }
    }
    return null
  }

  async function handleSingleModelCommand(data) {
    try {
      logger.debug(
        'SingleModelCommand: Processing instruction command with single model',
      )

      // AbortSignal automatically managed via Event-Driven StateManager
      // (No manual outputHandler.setAbortSignal needed)

      // Extract specific provider and model if provided
      const providerModel = data.models.length
        ? extractProviderModel(data.models[0])
        : null

      // Execute chat request with prepared content and provider model
      return await processSingleModelRequest(data.content, providerModel)
    } catch (error) {
      errorHandler.handleError(error, { component: 'SingleModelCommand' })
      return [] // Error already handled and shown to user - don't re-throw
    }
  }

  async function processSingleModelRequest(content, providerModel = null) {
    // Use StateManager directly instead of ServiceManager
    const stateManager = app.stateManager

    // Get existing abort controller from StateManager (created in ApplicationLoop)
    const controller = stateManager.getCurrentRequestController()
    if (!controller) {
      throw new Error('No abort controller available for request')
    }

    // Prepare messages with context
    const messages = prepareStreamingMessages(stateManager, content)

    // Create unified response session
    const session = sessionFactory.createSession({
      messages,
      controller,
      providerModel,
    })

    const spinner = createSpinner()

    session.on('session:init', () => {
      spinner.start(controller)
    })

    session.on('stream:first-chunk', () => {
      if (spinner.isActive()) {
        spinner.stop('success')
      }

      if (providerModel) {
        outputHandler.writeNewline()
        outputHandler.writeModel(providerModel)
      }
    })

    session.on('stream:chunk', ({ content }) => {
      if (content) {
        outputHandler.writeStream(content)
      }
    })

    session.on('session:error', () => {
      if (spinner.isActive()) {
        spinner.stop('error')
      }
    })

    try {
      const { text, aborted } = await session.start()

      if (aborted) {
        return
      }

      if (text.trim()) {
        process.stdout.write('\n')
      }

      updateContext(stateManager, content, text)
      outputHandler.writeContextDots(stateManager)
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      const processedError = errorHandler.processError(error, {
        component: 'SingleModelCommand',
      })

      if (spinner.isActive()) {
        spinner.stop('error')
      }

      errorHandler.displayError(processedError)
    } finally {
      session.dispose()
      spinner.dispose()
    }
  }

  // Return functional object (NO CLASS!)
  return {
    execute: handleSingleModelCommand,
  }
}
