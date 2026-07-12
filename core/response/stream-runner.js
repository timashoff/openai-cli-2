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
      onChunk,
      onComplete,
      completionOptions = null,
      streamLabel = null,
    } = options

    if (!controller) {
      throw new Error('AbortController is required to execute stream command')
    }

    const session = sessionFactory.createSession({
      messages,
      controller,
      providerModel,
      attachStreamProcessor,
      completionOptions,
    })

    const spinner = useSpinner ? createSpinner() : null

    if (useSpinner && spinner) {
      session.on('session:init', () => {
        spinner.start(controller)
      })
    }

    session.on('stream:first-chunk', ({ content }) => {
      if (useSpinner && spinner && spinner.isActive()) {
        // With a label, freeze inline ("✓ Xs ") so the label + streamed text
        // continue on the same line; otherwise stop normally (newline).
        if (streamLabel) {
          spinner.freeze()
        } else {
          spinner.stop('success')
        }
      }

      if (showModelHeader && providerModel) {
        outputHandler.writeNewline()
        outputHandler.writeModel(providerModel)
      }

      if (streamLabel) {
        outputHandler.writeStream(streamLabel)
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

    session.on('session:error', () => {
      if (useSpinner && spinner && spinner.isActive()) {
        spinner.stop('error')
      }
    })

    try {
      const result = await session.start()

      // Close the labelled line so the next leg/prompt starts clean.
      if (streamLabel && !result.aborted) {
        outputHandler.writeNewline()
      }

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
