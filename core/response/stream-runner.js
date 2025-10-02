import { createSpinner } from '../../utils/spinner.js'
import { outputHandler } from '../print/index.js'
import { createResponseSessionFactory } from './session.js'

export const createStreamCommandRunner = ({ stateManager }) => {
  if (!stateManager) {
    throw new Error('stateManager is required to create stream command runner')
  }

  const sessionFactory = createResponseSessionFactory({ stateManager })

  return async function runStreamCommand(options) {
    const {
      controller,
      messages,
      providerModel = null,
      attachStreamProcessor = false,
      showModelHeader = false,
      useSpinner = true,
      onFirstChunk,
      onChunk,
      onComplete,
      onError,
    } = options

    if (!controller) {
      throw new Error('AbortController is required to execute stream command')
    }

    const session = sessionFactory.createSession({
      messages,
      controller,
      providerModel,
      attachStreamProcessor,
    })

    const spinner = useSpinner ? createSpinner() : null

    if (useSpinner && spinner) {
      session.on('session:init', () => {
        spinner.start(controller)
      })
    }

    session.on('stream:first-chunk', ({ content }) => {
      if (useSpinner && spinner && spinner.isActive()) {
        spinner.stop('success')
      }

      if (showModelHeader && providerModel) {
        outputHandler.writeNewline()
        outputHandler.writeModel(providerModel)
      }

      if (onFirstChunk) {
        onFirstChunk({ content })
      }
    })

    session.on('stream:chunk', ({ content }) => {
      if (!content) {
        return
      }

      if (onChunk) {
        onChunk({ content })
      } else {
        outputHandler.writeStream(content)
      }
    })

    session.on('session:error', ({ error }) => {
      if (useSpinner && spinner && spinner.isActive()) {
        spinner.stop('error')
      }

      if (onError) {
        onError(error)
      }
    })

    try {
      const result = await session.start()

      if (!result.aborted && onComplete) {
        await onComplete(result)
      }

      return result
    } finally {
      if (spinner) {
        spinner.dispose()
      }

      session.dispose()
    }
  }
}
