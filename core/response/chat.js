import { logger } from '../../utils/logger.js'
import { errorHandler } from '../error-system/index.js'
import { outputHandler } from '../print/index.js'
import { updateContext } from '../../utils/context-utils.js'
import { createStreamResponder } from './handlers.js'

export function createChatHandler(app) {
  const stateManager = app.stateManager
  const respond = createStreamResponder({
    stateManager,
    attachStreamProcessor: true,
  })

  async function handleChatRequest(input) {
    logger.debug('ChatHandler: Processing direct chat request')

    try {
      const { aborted } = await respond({
        input,
        onComplete: async ({ text }) => {
          if (text.trim()) {
            process.stdout.write('\n~') //DEAD CODE?
          }

          updateContext(stateManager, input, text)
          outputHandler.writeContextDots(stateManager)
        },
      })

      if (aborted) {
        return
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      const processedError = errorHandler.processError(error, {
        component: 'ChatHandler',
      })

      errorHandler.displayError(processedError)
    }
  }

  return {
    handle: handleChatRequest,
  }
}
