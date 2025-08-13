/**
 * Processes streaming responses from different AI providers
 */
export class StreamProcessor {
  constructor(providerKey) {
    this.providerKey = providerKey
    // Check if provider is Claude-based (Anthropic)
    this.isClaudeProvider = providerKey === 'anthropic'
    this.isTerminated = false
    this.currentReader = null
    this.currentStream = null
  }

  /**
   * Force terminate any ongoing stream processing
   */
  forceTerminate() {
    this.isTerminated = true
    
    // Cancel reader if active
    if (this.currentReader) {
      try {
        this.currentReader.cancel()
      } catch (e) {
        // Ignore cancellation errors
      }
    }
    
    // Close stream if active
    if (this.currentStream) {
      try {
        this.currentStream.destroy?.()
      } catch (e) {
        // Ignore destruction errors
      }
    }
  }

  /**
   * Processes stream and returns response chunks
   */
  async processStream(stream, signal = null, onChunk = null) {
    this.isTerminated = false
    this.currentStream = stream
    
    // Check for immediate termination
    if (this.isTerminated) {
      throw new Error('AbortError')
    }
    
    const response = []

    try {
      if (this.isClaudeProvider) {
        await this.processClaudeStream(stream, response, signal, onChunk)
      } else {
        await this.processOpenAIStream(stream, response, signal, onChunk)
      }
    } finally {
      this.currentStream = null
      this.currentReader = null
    }

    return response
  }

  /**
   * Processes Claude streaming response
   */
  async processClaudeStream(stream, response, signal = null, onChunk = null) {
    const reader = stream.getReader()
    this.currentReader = reader
    const decoder = new TextDecoder()
    let done = false
    let buffer = ''
    let currentEvent = null
    
    while (!done) {
      // Check for termination first
      if (this.isTerminated) {
        reader.cancel()
        throw new Error('AbortError')
      }
      
      // Check for abort signal
      if (signal && signal.aborted) {
        reader.cancel()
        throw new Error('AbortError')
      }
      
      const { value, done: readerDone } = await reader.read()
      done = readerDone
      
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || ''
        
        for (const line of lines) {
          const trimmedLine = line.trim()
          
          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue
          }
          
          // Handle event lines - КРИТИЧЕСКИ ВАЖНО!
          if (trimmedLine.startsWith('event: ')) {
            currentEvent = trimmedLine.substring(7).trim()
            continue
          }
          
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.substring(6).trim()
            
            // Check for end of stream
            if (data === '[DONE]') {
              done = true
              break
            }
            
            // Skip empty data
            if (!data) {
              continue
            }
            
            try {
              const json = JSON.parse(data)
              
              // HANDLE ERROR EVENTS - БЛЯДЬ НАКОНЕЦ-ТО!
              if (currentEvent === 'error' || json.type === 'error') {
                const errorMessage = json.error?.message || json.message || 'Unknown Anthropic API error'
                const errorType = json.error?.type || json.type || 'unknown_error'
                reader.cancel()
                throw new Error(`Anthropic API Error (${errorType}): ${errorMessage}`)
              }
              
              // Handle content events
              if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
                response.push(json.delta.text)
                if (onChunk) onChunk(json.delta.text)
              } else if (json.delta && json.delta.text) {
                // Fallback for older format
                response.push(json.delta.text)
                if (onChunk) onChunk(json.delta.text)
              }
              
              // Reset event after processing data
              currentEvent = null
              
            } catch (e) {
              // If it's our intentional error throw, re-throw it
              if (e.message.includes('Anthropic API Error')) {
                throw e
              }
              
              // Only log parsing errors for unexpected data
              if (data !== '[DONE]') {
                console.error('JSON parsing error in Claude stream:', e.message, 'Data:', data.substring(0, 100))
              }
            }
          }
        }
      }
    }
  }

  /**
   * Processes OpenAI-compatible streaming response
   */
  async processOpenAIStream(stream, response, signal = null, onChunk = null) {
    try {
      for await (const chunk of stream) {
        // Check for termination first
        if (this.isTerminated) {
          throw new Error('Stream processing aborted')
        }
        
        // Check for abort signal
        if (signal && signal.aborted) {
          throw new Error('Stream processing aborted')
        }
        
        const content = chunk.choices[0]?.delta?.content
        if (content) {
          response.push(content)
          if (onChunk) onChunk(content)
        }
      }
    } catch (error) {
      if (this.isTerminated || (signal && signal.aborted)) {
        throw new Error('AbortError')
      }
      throw error
    }
  }
}