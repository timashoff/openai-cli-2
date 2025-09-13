export const createStreamProcessor = () => {
  const state = {
    isTerminated: false,
    currentReader: null,
    currentStream: null
  }

  const forceTerminate = () => {
    state.isTerminated = true

    if (state.currentReader) {
      try {
        state.currentReader.cancel()
      } catch (e) {
        // Ignore cancellation errors
      }
    }

    if (state.currentStream) {
      try {
        if (state.currentStream.destroy) {
          state.currentStream.destroy()
        }
      } catch (e) {
        // Ignore destruction errors
      }
    }
  }

  const processStream = async (stream, signal = null, onChunk = null) => {
    state.isTerminated = false
    state.currentStream = stream

    if (state.isTerminated) {
      throw new Error('AbortError')
    }

    const response = []

    try {
      // CRITICAL: Stream type detection order is EXTREMELY important!
      //
      // Web ReadableStream (Anthropic) has BOTH methods:
      // - stream.getReader() ✓ (native Web ReadableStream API)
      // - stream[Symbol.asyncIterator] ✓ (added in newer Node.js versions)
      //
      // MUST check getReader() FIRST!
      // If order is reversed, Anthropic streams will be incorrectly
      // processed as OpenAI streams and text output will fail.
      //
      // OpenAI streams only have Symbol.asyncIterator
      if (stream.getReader) {
        // Web ReadableStream (Anthropic)
        await processClaudeStream(stream, response, signal, onChunk)
      } else if (stream[Symbol.asyncIterator]) {
        // OpenAI-compatible stream (async iterable)
        await processOpenAIStream(stream, response, signal, onChunk)
      } else {
        throw new Error('Unknown stream type - neither async iterable nor ReadableStream')
      }
    } catch (error) {
      throw error
    } finally {
      state.currentStream = null
      state.currentReader = null
    }

    return response
  }

  const processClaudeStream = async (stream, response, signal = null, onChunk = null) => {
    const reader = stream.getReader()
    state.currentReader = reader
    const decoder = new TextDecoder()
    let done = false
    let buffer = ''
    let currentEvent = null

    while (!done) {
      if (state.isTerminated) {
        reader.cancel()
        throw new Error('AbortError')
      }

      if (signal && signal.aborted) {
        reader.cancel()
        throw new Error('AbortError')
      }

      const { value, done: readerDone } = await reader.read()
      done = readerDone

      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()

          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue
          }

          if (trimmedLine.startsWith('event: ')) {
            currentEvent = trimmedLine.substring(7).trim()
            continue
          }

          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.substring(6).trim()

            if (data === '[DONE]') {
              done = true
              break
            }

            if (!data) {
              continue
            }

            try {
              const json = JSON.parse(data)

              if (currentEvent === 'error' || json.type === 'error') {
                const errorMessage = (json.error && json.error.message) || json.message || 'Unknown Anthropic API error'
                const errorType = (json.error && json.error.type) || json.type || 'unknown_error'
                reader.cancel()
                throw new Error(`Anthropic API Error (${errorType}): ${errorMessage}`)
              }

              if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
                response.push(json.delta.text)
                if (onChunk) onChunk(json.delta.text)
              } else if (json.delta && json.delta.text) {
                response.push(json.delta.text)
                if (onChunk) onChunk(json.delta.text)
              }

              currentEvent = null

            } catch (e) {
              if (e.message.includes('Anthropic API Error')) {
                throw e
              }

              if (data !== '[DONE]') {
                console.error('JSON parsing error in Claude stream:', e.message, 'Data:', data.substring(0, 100))
              }
            }
          }
        }
      }
    }
  }

  const processOpenAIStream = async (stream, response, signal = null, onChunk = null) => {
    try {
      for await (const chunk of stream) {
        if (state.isTerminated) {
          throw new Error('Stream processing aborted')
        }

        if (signal && signal.aborted) {
          throw new Error('Stream processing aborted')
        }

        const content = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) ? chunk.choices[0].delta.content : null
        if (content) {
          response.push(content)
          if (onChunk && !signal.aborted) {
            onChunk(content)
          }
        }
      }
    } catch (error) {
      if (state.isTerminated || signal.aborted) {
        throw new Error('AbortError')
      }
      throw error
    }
  }

  return {
    processStream,
    forceTerminate
  }
}