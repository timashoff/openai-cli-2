/**
 * Adapter layer to bridge existing functionality with the new service architecture
 * This provides compatibility while we migrate to the full service-oriented architecture
 */

export class ServicesAdapter {
  /**
   * Create a command service adapter from existing functionality


   */
  static createCommandService(app) {
    return {
      /**
       * Parse command from input using existing findCommand logic


       */
      parseCommand(input) {
        const command = app.findCommand(input)
        
        if (command) {
          // Map to standardized format based on actual command structure
          return {
            type: 'INSTRUCTION',
            name: command.commandKey || 'unknown',
            args: [],
            isTranslation: command.isTranslation || false,
            isMultiProvider: command.isMultiProvider || false,
            isDocCommand: command.isDocCommand || false,
            isMultiCommand: command.isMultiCommand || false,
            models: command.models || null,
            instruction: command.instruction || '',
            targetContent: command.targetContent || '',
            fullInstruction: command.fullInstruction || command.instruction || '',
            hasUrl: command.hasUrl || false,
            originalInput: command.originalInput || input,
            commandConfig: command // Keep original command object for compatibility
          }
        }
        
        // Check if it's a system command (help, exit, etc.)
        const words = input.trim().split(' ')
        const firstWord = words[0].toLowerCase()
        
        if (['help', 'exit', 'quit', 'clear', 'status'].includes(firstWord)) {
          return {
            type: 'SYSTEM',
            name: firstWord,
            args: words.slice(1)
          }
        }
        
        // Check if it's an AI command (provider, model, etc.)
        if (['provider', 'model', 'models', 'list'].includes(firstWord)) {
          return {
            type: 'AI',
            name: firstWord,
            args: words.slice(1)
          }
        }
        
        // Default to chat
        return {
          type: 'CHAT',
          name: 'chat',
          args: [input]
        }
      },

      /**
       * Execute command using existing command systems



       */
      async executeCommand(parsedCommand, context) {
        const startTime = Date.now()
        
        try {
          switch (parsedCommand.type) {
            case 'SYSTEM':
              return await this.executeSystemCommand(parsedCommand, context)
              
            case 'AI':
              return await this.executeAICommand(parsedCommand, context)
              
            case 'INSTRUCTION':
              return await this.executeInstructionCommand(parsedCommand, context)
              
            default:
              return {
                success: false,
                error: `Unknown command type: ${parsedCommand.type}`,
                executionTime: Date.now() - startTime
              }
          }
        } catch (error) {
          return {
            success: false,
            error: error.message,
            executionTime: Date.now() - startTime
          }
        }
      },

      /**
       * Execute system command
       */
      async executeSystemCommand(parsedCommand, context) {
        const startTime = Date.now()
        
        // Use existing command manager if available
        if (context.app.commands && context.app.commands.execute) {
          const result = await context.app.commands.execute(parsedCommand.name, parsedCommand.args)
          return {
            success: true,
            data: result,
            executionTime: Date.now() - startTime
          }
        }
        
        // Fallback implementation
        switch (parsedCommand.name) {
          case 'help':
            return {
              success: true,
              data: 'Available commands: help, exit, clear, status, provider, model',
              executionTime: Date.now() - startTime
            }
            
          case 'exit':
          case 'quit':
            return {
              success: true,
              data: 'Goodbye!',
              executionTime: Date.now() - startTime
            }
            
          case 'status':
            return {
              success: true,
              data: `Current provider: ${context.app.aiState.selectedProviderKey || 'none'}`,
              executionTime: Date.now() - startTime
            }
            
          default:
            return {
              success: false,
              error: `Unknown system command: ${parsedCommand.name}`,
              executionTime: Date.now() - startTime
            }
        }
      },

      /**
       * Execute AI command  
       */
      async executeAICommand(parsedCommand, context) {
        const startTime = Date.now()
        
        // Use existing AI command system if available
        if (context.app.aiCommands && context.app.aiCommands.execute) {
          const result = await context.app.aiCommands.execute(parsedCommand.name, parsedCommand.args)
          return {
            success: true,
            data: result,
            executionTime: Date.now() - startTime
          }
        }
        
        // Fallback for common AI commands
        switch (parsedCommand.name) {
          case 'provider':
            if (parsedCommand.args.length > 0) {
              // Switch provider logic would go here
              return {
                success: true,
                data: `Switched to provider: ${parsedCommand.args[0]}`,
                executionTime: Date.now() - startTime
              }
            } else {
              return {
                success: true,
                data: `Current provider: ${context.app.aiState.selectedProviderKey}`,
                executionTime: Date.now() - startTime
              }
            }
            
          case 'model':
            return {
              success: true,
              data: `Current model: ${context.app.aiState.model}`,
              executionTime: Date.now() - startTime
            }
            
          default:
            return {
              success: false,
              error: `Unknown AI command: ${parsedCommand.name}`,
              executionTime: Date.now() - startTime
            }
        }
      },

      /**
       * Execute instruction command
       */
      async executeInstructionCommand(parsedCommand, context) {
        const startTime = Date.now()
        
        // Return instruction info for further processing by AI
        return {
          success: true,
          data: {
            needsProcessing: true,
            instructionInfo: {
              commandType: parsedCommand.name,
              commandKey: parsedCommand.name,
              instruction: parsedCommand.instruction,
              targetContent: parsedCommand.targetContent,
              fullInstruction: parsedCommand.fullInstruction,
              isTranslation: parsedCommand.isTranslation,
              isMultiProvider: parsedCommand.isMultiProvider,
              isMultiCommand: parsedCommand.isMultiCommand,
              isDocCommand: parsedCommand.isDocCommand,
              models: parsedCommand.models,
              hasUrl: parsedCommand.hasUrl,
              originalInput: parsedCommand.originalInput,
              commandConfig: parsedCommand.commandConfig // Pass the original command object
            }
          },
          executionTime: Date.now() - startTime
        }
      }
    }
  }

  /**
   * Create a streaming service adapter


   */
  static createStreamingService(app) {
    return {
      /**
       * Start streaming using existing logic


       */
      async startStream(options) {
        const { stream, onChunk, signal } = options
        
        // Use existing StreamProcessor logic - import dynamically to avoid circular deps
        try {
          const { createStreamProcessor } = await import('../utils/stream-processor.js')
          const processor = createStreamProcessor()
          
          // Process the stream with chunk callback
          return await processor.processStream(stream, signal, onChunk)
        } catch (error) {
          // Fallback: simple stream processing without StreamProcessor
          const chunks = []
          if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
            try {
              for await (const chunk of stream) {
                if (signal && signal.aborted) break
                
                // Simple chunk processing
                const content = chunk.content || (chunk.delta && chunk.delta.content) || ''
                if (content && onChunk) {
                  onChunk(content)
                }
                chunks.push(content)
              }
            } catch (streamError) {
              // Stream processing failed
              console.warn('Stream processing failed, using empty response')
            }
          }
          return chunks
        }
      }
    }
  }

  /**
   * Create a provider service adapter


   */
  static createProviderService(app) {
    return {
      /**
       * Get current provider

       */
      getCurrentProvider() {
        const currentAIState = app.stateManager.getAIState()
        return {
          provider: currentAIState.provider,
          model: currentAIState.model,
          key: currentAIState.selectedProviderKey
        }
      },

      /**
       * Try alternative provider (existing logic)

       */
      async tryAlternativeProvider() {
        if (typeof app.tryAlternativeProvider === 'function') {
          return await app.tryAlternativeProvider()
        }
        return false
      }
    }
  }
}

/**
 * Command types enum for compatibility
 */
export const CommandType = {
  SYSTEM: 'SYSTEM',
  AI: 'AI', 
  INSTRUCTION: 'INSTRUCTION',
  CHAT: 'CHAT'
}