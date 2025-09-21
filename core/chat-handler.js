import { logger } from '../utils/logger.js'
import { createSpinner } from '../utils/spinner.js'
import { errorHandler } from './error-system/index.js'
import { outputHandler } from './print/index.js'
import { prepareStreamingMessages } from '../utils/message-utils.js'
import { updateContext } from '../utils/context-utils.js'
import { createResponseSessionFactory } from './response/index.js'

export function createChatHandler(app) {
  const sessionFactory = createResponseSessionFactory({ stateManager: app.stateManager })

  async function handleChatRequest(input) {
    logger.debug('ChatHandler: Processing direct chat request')

    // Use StateManager directly instead of ServiceManager
    const stateManager = app.stateManager

    // Get existing abort controller from StateManager (created in ApplicationLoop)
    const controller = stateManager.getCurrentRequestController()
    if (!controller) {
      throw new Error('No abort controller available for request')
    }

    // Create spinner
    const spinner = createSpinner()

    // Prepare messages with context
    const messages = prepareStreamingMessages(stateManager, input)

    const session = sessionFactory.createSession({
      messages,
      controller,
      attachStreamProcessor: true,
    })

    session.on('session:init', () => {
      spinner.start(controller)
    })

    session.on('stream:first-chunk', () => {
      if (spinner.isActive()) {
        spinner.stop('success')
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

      updateContext(stateManager, input, text)
      outputHandler.writeContextDots(stateManager)
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      const processedError = errorHandler.processError(error, {
        component: 'ChatHandler',
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

  return {
    handle: handleChatRequest,
  }
}
