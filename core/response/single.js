import { logger } from '../../utils/logger.js'
import { errorHandler } from '../error-system/index.js'
import { outputHandler } from '../print/index.js'
import { updateContext } from '../../utils/context-utils.js'
import { createStreamResponder } from './handlers.js'

export function createSingleModelCommand(app) {
  const stateManager = app.stateManager
  const respond = createStreamResponder({
    stateManager,
    showModelHeader: true,
  })

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

      const providerModel = data.models.length
        ? extractProviderModel(data.models[0])
        : null

      return await processSingleModelRequest(data.content, providerModel)
    } catch (error) {
      errorHandler.handleError(error, { component: 'SingleModelCommand' })
      return []
    }
  }

  async function processSingleModelRequest(content, providerModel = null) {
    try {
      const { text, aborted } = await respond({
        input: content,
        providerModel,
        onComplete: async ({ text }) => {
          if (text.trim()) {
            process.stdout.write('\n')
          }

          updateContext(stateManager, content, text)
          outputHandler.writeContextDots(stateManager)
        },
      })

      if (aborted) {
        return
      }

      return text
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      const processedError = errorHandler.processError(error, {
        component: 'SingleModelCommand',
      })

      errorHandler.displayError(processedError)
    }
  }

  return {
    execute: handleSingleModelCommand,
  }
}
