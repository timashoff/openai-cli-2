/**
 * Processes streaming responses from different AI providers
 */
export class StreamProcessor {
  constructor(providerKey) {
    this.providerKey = providerKey
    // Check if provider is Claude-based (Anthropic)
    this.isClaudeProvider = providerKey === 'anthropic'
  }

  /**
   * Processes stream and returns response chunks
   */
  async processStream(stream) {
    const response = []

    if (this.isClaudeProvider) {
      await this.processClaudeStream(stream, response)
    } else {
      await this.processOpenAIStream(stream, response)
    }

    return response
  }

  /**
   * Processes Claude streaming response
   */
  async processClaudeStream(stream, response) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let done = false
    let buffer = ''
    
    while (!done) {
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
              
              // Handle different event types
              if (json.type === 'content_block_delta' && json.delta && json.delta.text) {
                response.push(json.delta.text)
              } else if (json.delta && json.delta.text) {
                // Fallback for older format
                response.push(json.delta.text)
              }
            } catch (e) {
              // Only log if it's not a known non-JSON line
              if (data !== '[DONE]' && !data.startsWith('event:')) {
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
  async processOpenAIStream(stream, response) {
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        response.push(content)
      }
    }
  }
}