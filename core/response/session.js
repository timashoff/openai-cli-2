import { EventEmitter } from 'node:events'
import { createStreamProcessor } from '../../utils/stream-processor.js'
import { isCancellation } from '../error-system/index.js'

export const createResponseSessionFactory = ({ stateManager }) => {
  if (!stateManager) {
    throw new Error('stateManager is required to create response session factory')
  }

  function createSession({
    messages,
    controller,
    providerModel = null,
    attachStreamProcessor = false,
    completionOptions = null,
  }) {
    if (!controller) {
      throw new Error('AbortController is required to start response session')
    }

    const events = new EventEmitter()
    const chunks = []

    let streamProcessor = null

    const start = async () => {
      streamProcessor = createStreamProcessor()

      if (attachStreamProcessor && stateManager.setStreamProcessor) {
        stateManager.setStreamProcessor(streamProcessor)
      }

      events.emit('session:init', {
        controller,
        providerModel,
      })

      let responseId = null

      try {
        const stream = await stateManager.createChatCompletion(
          messages,
          {
            stream: true,
            signal: controller.signal,
            ...(completionOptions || {}),
          },
          providerModel || undefined,
        )

        let firstChunk = true

        await streamProcessor.processStream(
          stream,
          controller.signal,
          async (content) => {
            if (!content || controller.signal.aborted) {
              return
            }

            if (firstChunk) {
              firstChunk = false
              events.emit('stream:first-chunk', { content })
            }

            chunks.push(content)
            events.emit('stream:chunk', { content })
          },
          (id) => {
            responseId = id
          },
        )

        const text = chunks.join('')

        return {
          text,
          chunks,
          aborted: false,
          responseId,
        }
      } catch (error) {
        if (controller.signal.aborted || isCancellation(error)) {
          // An aborted stream still completes and stays stored server-side
          // (verified live) — clean it up so the chain never sees it. Target the
          // pinned provider when there is one, or the delete hits the wrong API.
          if (completionOptions && completionOptions.store && responseId) {
            stateManager.deleteStoredResponse(
              responseId,
              providerModel ? providerModel.provider : null,
            )
          }
          return {
            text: '',
            chunks: [],
            aborted: true,
            responseId: null,
          }
        }

        events.emit('session:error', { error })
        throw error
      } finally {
        if (attachStreamProcessor && stateManager.setStreamProcessor) {
          stateManager.setStreamProcessor(null)
        }
        // Remove listeners tied to this session
        events.removeAllListeners()
      }
    }

    const once = (event, handler) => {
      events.once(event, handler)
      return () => events.off(event, handler)
    }

    const on = (event, handler) => {
      events.on(event, handler)
      return () => events.off(event, handler)
    }

    const dispose = () => {
      if (streamProcessor && streamProcessor.forceTerminate) {
        streamProcessor.forceTerminate()
      }
      events.removeAllListeners()
    }

    return {
      start,
      on,
      once,
      dispose,
    }
  }

  return {
    createSession,
  }
}
