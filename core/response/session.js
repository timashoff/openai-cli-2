import { EventEmitter } from 'node:events'
import { createStreamProcessor } from '../../utils/stream-processor.js'

export const createResponseSessionFactory = ({ stateManager }) => {
  if (!stateManager) {
    throw new Error('stateManager is required to create response session factory')
  }

  function createSession({
    messages,
    controller,
    providerModel = null,
    attachStreamProcessor = false,
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

      try {
        const stream = await stateManager.createChatCompletion(
          messages,
          {
            stream: true,
            signal: controller.signal,
          },
          providerModel || undefined,
        )

        events.emit('session:stream-started', {
          controller,
          providerModel,
        })

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
        )

        const text = chunks.join('')
        events.emit('session:completed', {
          text,
          chunks,
        })

        return {
          text,
          chunks,
          aborted: false,
        }
      } catch (error) {
        if (controller.signal.aborted || error.message === 'AbortError') {
          events.emit('session:aborted', { error })
          return {
            text: '',
            chunks: [],
            aborted: true,
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
