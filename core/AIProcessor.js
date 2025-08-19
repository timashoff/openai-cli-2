/**
 * AIProcessor - Extracted AI processing logic from monolith decomposition
 * Handles AI input processing, MCP integration, streaming, caching, and provider management
 */
import { APP_CONSTANTS, UI_SYMBOLS } from '../config/constants.js'
import { getClipboardContent, getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { getCommandRepository } from '../patterns/CommandRepository.js'
import cache from '../utils/cache.js'
import { errorHandler } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import { color } from '../config/color.js'
import { multiCommandProcessor } from '../utils/multi-command-processor.js'
import { fetchMCPServer } from '../utils/fetch-mcp-server.js'
import { searchMCPServer } from '../utils/search-mcp-server.js'
import { mcpManager } from '../utils/mcp-manager.js'
import { intentDetector } from '../utils/intent-detector.js'
import { openInBrowser } from '../utils/index.js'
import { commandObserver, COMMAND_EVENTS } from '../patterns/CommandObserver.js'
import { HandlerChainFactory } from '../handlers/handler-chain-factory.js'
import { globalEventBus } from '../utils/event-bus.js'

export class AIProcessor {
  constructor(app) {
    this.app = app
    this.handlerChain = null
    this.handlerChainEnabled = false
    this.initializeHandlerChain()
  }

  /**
   * Initialize the Handler Chain for modern request processing
   */
  initializeHandlerChain() {
    try {
      const dependencies = {
        eventBus: globalEventBus,
        logger: logger,
        errorBoundary: null // Optional for now
      }

      // Create essential handler chain
      this.handlerChain = HandlerChainFactory.createRequestChain(dependencies)
      
      // Validate the chain
      const validation = HandlerChainFactory.validateChain(this.handlerChain)
      if (validation.valid) {
        logger.info(`Handler Chain initialized: ${validation.handlerTypes.join(' → ')}`)
        // Enable after testing
        // this.handlerChainEnabled = true
      } else {
        logger.error(`Handler Chain validation failed: ${validation.error}`)
      }
    } catch (error) {
      logger.error(`Failed to initialize Handler Chain: ${error.message}`)
    }
  }

  /**
   * Enable/disable Handler Chain processing
   * @param {boolean} enabled - Whether to enable Handler Chain
   */
  setHandlerChainEnabled(enabled) {
    if (!this.handlerChain) {
      logger.warn('Cannot enable Handler Chain - not initialized')
      return false
    }

    const wasEnabled = this.handlerChainEnabled
    this.handlerChainEnabled = enabled
    
    logger.info(`Handler Chain ${enabled ? 'enabled' : 'disabled'}`)
    
    // Log handler chain status
    if (enabled && this.handlerChain) {
      const stats = HandlerChainFactory.getChainStats(this.handlerChain)
      logger.info('Handler Chain stats:', stats)
    }
    
    return true
  }

  /**
   * Get Handler Chain status and statistics
   * @returns {Object} Handler Chain information
   */
  getHandlerChainInfo() {
    if (!this.handlerChain) {
      return {
        initialized: false,
        enabled: false,
        error: 'Handler Chain not initialized'
      }
    }

    return {
      initialized: true,
      enabled: this.handlerChainEnabled,
      stats: HandlerChainFactory.getChainStats(this.handlerChain),
      health: HandlerChainFactory.getChainHealth(this.handlerChain),
      validation: HandlerChainFactory.validateChain(this.handlerChain)
    }
  }

  /**
   * Process input using Handler Chain (modern approach)
   */
  async processInputWithHandlerChain(input, cliManager) {
    if (!this.handlerChain || !this.handlerChainEnabled) {
      throw new Error('Handler Chain not available')
    }

    try {
      // Create processing context
      const context = {
        originalInput: input,
        processedInput: input,
        command: null,
        flags: {},
        metadata: {},
        services: {
          app: this.app,
          cliManager: cliManager,
          multiCommandProcessor: multiCommandProcessor,
          cache: cache
        },
        abortController: new AbortController(),
        startTime: new Date(),
        processingData: new Map()
      }

      // Process through handler chain
      const result = await this.handlerChain[0].handle(context)
      
      logger.debug('Handler Chain result:', result)
      
      return result
    } catch (error) {
      logger.error('Handler Chain processing failed:', error)
      throw error
    }
  }

  /**
   * Process AI input (extracted from original business logic)
   */
  async processAIInput(input, cliManager) {
    // Option to use Handler Chain (disabled by default for stability)
    if (this.handlerChainEnabled && this.handlerChain) {
      logger.debug('Using Handler Chain for request processing')
      try {
        return await this.processInputWithHandlerChain(input, cliManager)
      } catch (error) {
        logger.error('Handler Chain failed, falling back to legacy processing:', error)
        // Fall through to legacy processing
      }
    }

    // Critical business logic - keep original implementation
    let interval
    let startTime
    const originalInput = input

    // Emit input received event
    commandObserver.emit(COMMAND_EVENTS.INPUT_RECEIVED, {
      input: input,
      length: input.length,
      hasClipboard: input.includes(APP_CONSTANTS.CLIPBOARD_MARKER),
      hasForceFlag: input.includes('-f') || input.includes('--force')
    })

    const controller = new AbortController()
    cliManager.setProcessingRequest(true, controller)

    // Check for clipboard content FIRST
    if (input.includes(APP_CONSTANTS.CLIPBOARD_MARKER)) {
      try {
        const buffer = await getClipboardContent()
        const sanitizedBuffer = sanitizeString(buffer)
        validateString(sanitizedBuffer, 'clipboard content', false)
        
        if (sanitizedBuffer.length > configManager.get('maxInputLength')) {
          console.log(`${color.red}Error: Clipboard content too large (max ${configManager.get('maxInputLength')} characters)${color.reset}`)
          return
        }
        
        input = input.replace(new RegExp(APP_CONSTANTS.CLIPBOARD_MARKER.replace(/\\$/g, '\\\\$'), 'g'), sanitizedBuffer)
        console.log(`${color.grey}[Clipboard content inserted (${sanitizedBuffer.length} chars)]${color.reset}`)
      } catch (error) {
        errorHandler.handleError(error, { context: 'clipboard_read' })
        return
      }
    }

    // Check for force flags (SIMPLE STRING VERSION)
    let forceRequest = false
    const forceFlags = ['-f', '--force']
    for (const baseFlag of forceFlags) {
      if (input.endsWith(' ' + baseFlag) || input.endsWith(baseFlag)) {
        forceRequest = true
        input = input.replace(' ' + baseFlag, '').replace(baseFlag, '').trim()
        break
      }
    }

    // Find command
    const command = await this.findCommand(input)
    
    // Emit command detection event
    if (command) {
      commandObserver.emit(COMMAND_EVENTS.COMMAND_DETECTED, {
        commandKey: command.commandKey,
        commandType: command.commandType,
        isSystemCommand: false,
        isAICommand: false,
        isTranslation: command.isTranslation,
        hasMultipleModels: command.models && command.models.length > 1,
        hasUrl: command.hasUrl
      })
      
      commandObserver.emit(COMMAND_EVENTS.COMMAND_PARSED, {
        command: command,
        hasMultipleModels: command.models && command.models.length > 1,
        isTranslation: command.isTranslation,
        hasUrl: command.hasUrl
      })
    } else {
      commandObserver.emit(COMMAND_EVENTS.COMMAND_NOT_FOUND, {
        input: input.substring(0, 100)
      })
    }

    // Handle MCP processing (simplified for Phase 2)
    if (command && command.hasUrl) {
      const mcpResult = await this.processMCPInput(command.targetContent, command)
      if (mcpResult && mcpResult.mcpData) {
        console.log(`\\n${color.cyan}[MCP]${color.reset}`)
        console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
        console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        
        if (command.isTranslation) {
          const webTranslationInstruction = command.instruction.replace('text', 'entire article/webpage content completely')
          input = `${webTranslationInstruction}: ${mcpResult.mcpData.content}`
        } else {
          input = mcpResult.enhancedInput
        }
      } else {
        input = command.fullInstruction
      }
    } else if (command && command.isTranslation) {
      input = command.fullInstruction
    } else {
      const mcpResult = await this.processMCPInput(input, command)
      if (mcpResult) {
        input = mcpResult.enhancedInput
        if (mcpResult.directResponse) {
          console.log(`\\n${color.cyan}[MCP Data]${color.reset}`)
          console.log(mcpResult.directResponse)
          return
        }
        if (mcpResult.showMCPData) {
          console.log(`\\n${color.cyan}[MCP]${color.reset}`)
          console.log(`${color.grey}Source: ${mcpResult.mcpData.url}${color.reset}`)
          console.log(`${color.grey}Content: ${mcpResult.mcpData.content.length} chars${color.reset}`)
        }
      }
    }

    const finalInput = (command && command.isTranslation && command.hasUrl) ? input : 
                      (command ? command.fullInstruction : input)
    
    // Create normalized cache key WITHOUT force flags
    let rawCacheKey = (command && command.isTranslation && command.hasUrl) ? command.originalInput : finalInput
    let cacheKey = rawCacheKey
    // Use already declared forceFlags from above
    for (const flag of forceFlags) {
      cacheKey = cacheKey.replace(' ' + flag, '').replace(flag, '').trim()
    }

    // Handle multi-model commands (modern architecture)
    if (command && command.models && Array.isArray(command.models) && command.models.length > 1) {
      // Check cache for multi-model commands (using clean user input as key)
      if (command.cache_enabled && !forceRequest && cache.has(cacheKey)) {
        const cachedResponse = cache.get(cacheKey)
        commandObserver.emit(COMMAND_EVENTS.CACHE_HIT, {
          cacheKey: cacheKey.substring(0, 50),
          cacheType: 'multi-model',
          responseLength: cachedResponse.length,
          commandKey: command.commandKey
        })
        
        console.log(`${color.yellow}[from cache]${color.reset}`)
        process.stdout.write(cachedResponse + '\n')
        return
      } else if (command.cache_enabled && !forceRequest) {
        commandObserver.emit(COMMAND_EVENTS.CACHE_MISS, {
          cacheKey: cacheKey.substring(0, 50),
          cacheType: 'multi-model',
          commandKey: command.commandKey
        })
      }
      
      try {
        // Show handler info at the very beginning
        console.log(`[Handler: ${command.commandKey}]\n`)
        
        // Emit multi-command started event
        const multiStartTime = Date.now()
        commandObserver.emit(COMMAND_EVENTS.MULTI_COMMAND_STARTED, {
          commandKey: command.commandKey,
          commandType: command.commandType,
          modelCount: command.models.length,
          models: command.models
        })
        
        // Let multiCommandProcessor handle output with proper formatting
        const multiResult = await multiCommandProcessor.executeMultiple(
          finalInput,
          controller.signal,
          command.models,
          null, // defaultModel
          null  // no onProviderComplete callback - headers handled in MultiCommandProcessor
        )
        
        // Emit multi-command completed event
        commandObserver.emit(COMMAND_EVENTS.MULTI_COMMAND_COMPLETED, {
          commandKey: command.commandKey,
          duration: Date.now() - multiStartTime,
          success: multiResult && multiResult.successful > 0,
          successfulModels: multiResult?.successful || 0,
          totalModels: multiResult?.total || command.models.length,
          responseLength: multiResult?.results?.reduce((total, r) => total + (r.response?.length || 0), 0) || 0
        })
        
        // Cache the formatted multi-model response for commands with caching enabled
        if (command.cache_enabled && multiResult && multiResult.results) {
          const formattedResponse = multiCommandProcessor.formatMultiResponse(multiResult, command.commandKey)
          await cache.set(cacheKey, formattedResponse)
          
          commandObserver.emit(COMMAND_EVENTS.CACHE_STORED, {
            cacheKey: cacheKey.substring(0, 50),
            cacheType: 'multi-model',
            responseLength: formattedResponse.length,
            commandKey: command.commandKey
          })
        }
        
        return
      } catch (error) {
        errorHandler.handleError(error, { context: 'multi_model_processing' })
        return
      }
    }

    // Standard single-provider cache check for commands with caching enabled
    if (command && command.cache_enabled && !forceRequest && cache.has(cacheKey)) {
      const cachedResponse = cache.get(cacheKey)
      commandObserver.emit(COMMAND_EVENTS.CACHE_HIT, {
        cacheKey: cacheKey.substring(0, 50),
        cacheType: 'single-model',
        responseLength: cachedResponse.length,
        commandKey: command.commandKey
      })
      
      console.log(`${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cachedResponse + '\\n')
      return
    } else if (command && command.cache_enabled && !forceRequest) {
      commandObserver.emit(COMMAND_EVENTS.CACHE_MISS, {
        cacheKey: cacheKey.substring(0, 50),
        cacheType: 'single-model',
        commandKey: command.commandKey
      })
    }

    // Handle single-model commands with specific provider/model
    if (command && command.models && Array.isArray(command.models) && command.models.length === 1) {
      const modelData = command.models[0]
      let modelString, providerKey, modelName
      
      // Handle different data formats for command.models[0]
      if (typeof modelData === 'string') {
        // Format: "deepseek-chat"
        modelString = modelData
      } else if (typeof modelData === 'object' && modelData !== null) {
        // Format: {provider: "deepseek", model: "deepseek-chat"} or {model: "deepseek-chat"}
        if (modelData.model) {
          modelString = modelData.model
          if (modelData.provider) {
            providerKey = modelData.provider
          }
        } else {
          throw new Error(`Invalid model object format: ${JSON.stringify(modelData)}`)
        }
      } else {
        throw new Error(`Invalid model format: ${JSON.stringify(modelData)} (type: ${typeof modelData})`)
      }
      
      // Parse provider and model from model string if provider not already set
      if (!providerKey) {
        if (modelString.includes('gpt-')) {
          providerKey = 'openai'
        } else if (modelString.includes('deepseek')) {
          providerKey = 'deepseek'
        } else if (modelString.includes('claude')) {
          providerKey = 'anthropic'
        } else {
          // Fallback: try to extract provider from model name prefix
          const parts = modelString.split('-')
          providerKey = parts[0]
        }
      }
      
      modelName = modelString
      
      try {
        // Import provider factory for single command execution
        const { createProvider } = await import('../utils/provider-factory.js')
        const { API_PROVIDERS } = await import('../config/api_providers.js')
        
        const providerConfig = API_PROVIDERS[providerKey]
        if (!providerConfig) {
          throw new Error(`Provider config not found for: ${providerKey}`)
        }
        
        // Check if provider has API key
        if (!process.env[providerConfig.apiKeyEnv]) {
          throw new Error(`API key not found for ${providerKey}. Set ${providerConfig.apiKeyEnv} environment variable.`)
        }
        
        // Create temporary provider instance
        const providerInstance = createProvider(providerKey, providerConfig)
        await providerInstance.initializeClient()
        
        let messages = []
        if (command.isTranslation) {
          messages = [{ role: 'user', content: finalInput }]
        } else {
          messages = this.app.state.contextHistory.map(({ role, content }) => ({ role, content }))
          messages.push({ role: 'user', content: finalInput })
        }
        
        console.log(`[Handler: ${command.commandKey}] → ${providerKey}/${modelName}\n`)
        
        startTime = Date.now()
        
        let i = 0
        process.stdout.write('\x1B[?25l')
        const spinnerInterval = setInterval(() => {
          clearTerminalLine()
          const elapsedTime = getElapsedTime(startTime)
          process.stdout.write(
            `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
          )
        }, configManager.get('spinnerInterval'))
        cliManager.setSpinnerInterval(spinnerInterval)
        interval = spinnerInterval
        
        // Use specific provider and model (like multi-command-processor)
        const stream = await providerInstance.createChatCompletion(modelName, messages, {
          stream: true,
          signal: controller.signal
        })

        const streamProcessor = new StreamProcessor(providerKey)
        cliManager.setProcessingRequest(true, controller, streamProcessor)
        let response = []
        let firstChunk = true

        const chunks = await streamProcessor.processStream(stream, controller.signal, (chunk) => {
          if (firstChunk) {
            clearInterval(interval)
            clearTerminalLine()
            process.stdout.write('\x1B[?25h')
            cliManager.setProcessingRequest(false)
            cliManager.setTypingResponse(true)
            firstChunk = false
          }
          process.stdout.write(chunk)
        })

        response = chunks

        // Cache handling for single-model commands with caching enabled
        if (command.cache_enabled && response.length > 0) {
          const responseText = response.join('')
          if (responseText.trim()) {
            await cache.set(cacheKey, responseText)
            
            commandObserver.emit(COMMAND_EVENTS.CACHE_STORED, {
              cacheKey: cacheKey.substring(0, 50),
              cacheType: 'single-model',
              responseLength: responseText.length,
              commandKey: command.commandKey
            })
          }
        }
        
        // Add to context history if not translation
        if (!command.isTranslation && response.length > 0) {
          this.app.state.contextHistory.push({ role: 'user', content: finalInput })
          this.app.state.contextHistory.push({ role: 'assistant', content: response.join('') })
        }
        
        cliManager.setTypingResponse(false)
        return
        
      } catch (error) {
        if (interval) {
          clearInterval(interval)
          clearTerminalLine()
          process.stdout.write('\x1B[?25h')
        }
        cliManager.setProcessingRequest(false)
        cliManager.setTypingResponse(false)
        
        // Handle provider errors gracefully
        console.log(`\n${color.red}❌ Provider not working: ${providerKey}${color.reset}`)
        console.log(`${color.yellow}Falling back to current provider...${color.reset}\n`)
        
        // Fall through to default provider logic below
      }
    }

    try {
      let messages = []
      if (command && command.isTranslation) {
        messages = [{ role: 'user', content: finalInput }]
      } else {
        messages = this.app.state.contextHistory.map(({ role, content }) => ({ role, content }))
        messages.push({ role: 'user', content: finalInput })
      }

      startTime = Date.now()

      let i = 0
      process.stdout.write('\x1B[?25l')
      const spinnerInterval = setInterval(() => {
        clearTerminalLine()
        const elapsedTime = getElapsedTime(startTime)
        process.stdout.write(
          `${color.reset}${UI_SYMBOLS.SPINNER[i++ % UI_SYMBOLS.SPINNER.length]} ${elapsedTime}s${color.reset}`,
        )
      }, configManager.get('spinnerInterval'))
      cliManager.setSpinnerInterval(spinnerInterval)
      interval = spinnerInterval

      const currentAIState = this.app.stateManager.getAIState()
      
      // Check if provider key is available - provider instance will be lazy loaded
      if (!currentAIState.selectedProviderKey) {
        throw new Error(`No provider selected`)
      }
      
      // Use ServiceManager to handle lazy loading of provider
      const aiService = this.app.serviceManager.getAIProviderService()
      const stream = await aiService.createChatCompletion(messages, {
        stream: true,
        signal: controller.signal
      })

      const streamProcessor = new StreamProcessor(currentAIState.selectedProviderKey)
      cliManager.setProcessingRequest(true, controller, streamProcessor)
      let response = []
      let firstChunk = true
      
      const onChunk = async (content) => {
        const cliState = cliManager.getState()
        if (controller?.signal?.aborted || cliState.shouldReturnToPrompt) {
          return
        }
        
        if (firstChunk) {
          clearInterval(interval)
          cliManager.setSpinnerInterval(null)
          
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime)
          
          cliManager.setProcessingRequest(false)
          cliManager.setTypingResponse(true)
          firstChunk = false
        }
        
        if (cliManager.getState().isTypingResponse) {
          process.stdout.write(content)
        }
      }
      
      try {
        response = await Promise.race([
          streamProcessor.processStream(stream, controller.signal, onChunk),
          new Promise((resolve, reject) => {
            const abortHandler = () => {
              setTimeout(() => reject(new Error('AbortError')), 0)
            }
            
            if (controller && controller.signal) {
              controller.signal.addEventListener('abort', abortHandler, { once: true })
            }
            
            const rapidCheck = () => {
              if (!controller || !controller.signal) {
                return
              }
              
              const cliState = cliManager.getState()
              if (streamProcessor?.isTerminated || cliState.shouldReturnToPrompt) {
                setTimeout(() => reject(new Error('AbortError')), 0)
              } else if (!controller.signal.aborted) {
                setTimeout(rapidCheck, 5)
              }
            }
            rapidCheck()
          })
        ])
      } catch (error) {
        if (error.message === 'AbortError' || error.name === 'AbortError' || error.message.includes('aborted')) {
          response = []
        } else {
          throw error
        }
      }

      clearInterval(interval)

      const cliState = cliManager.getState()
      if (controller.signal.aborted || cliState.shouldReturnToPrompt) {
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('error', finalTime)
        }
        
        cliManager.setShouldReturnToPrompt(false)
        cliManager.setTypingResponse(false)
        return
      } else {
        cliManager.setTypingResponse(false)
        
        if (firstChunk) {
          const finalTime = getElapsedTime(startTime)
          clearTerminalLine()
          showStatus('success', finalTime, 'No content received.')
        } else {
          if (command && command.isTranslation) {
            process.stdout.write('\n')
          }
        }
        
        if (cliState.shouldReturnToPrompt) {
          cliManager.setShouldReturnToPrompt(false)
          return
        }

        const fullResponse = response.join('')
        if (command && command.cache_enabled) {
          await cache.set(cacheKey, fullResponse)
        } else {
          this.app.addToContext('user', finalInput)
          this.app.addToContext('assistant', fullResponse)
          
          const maxHistory = configManager.get('maxContextHistory')
          if (this.app.state.contextHistory.length > maxHistory) {
            this.app.state.contextHistory = this.app.state.contextHistory.slice(-maxHistory)
          }
          
          const historyDots = '.'.repeat(this.app.state.contextHistory.length)
          process.stdout.write('\n' + color.yellow + historyDots + color.reset + '\n')
        }
      }
    } catch (error) {
      if (interval) clearInterval(interval)
      process.stdout.write('')
      const finalTime = getElapsedTime(startTime)

      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        clearTerminalLine()
        showStatus('error', finalTime)
      } else {
        clearTerminalLine()
        showStatus('error', finalTime)
        
        // Handle provider-specific errors with user-friendly UI
        if (error.message && error.message.includes('is not working properly')) {
          const providerMatch = error.message.match(/Current provider \((\w+)\)/)
          const providerName = providerMatch ? providerMatch[1] : 'current provider'
          
          console.log(`\n${color.red}❌ Provider not working: ${providerName}${color.reset}`)
          
          try {
            // Ask user if they want to switch providers
            const answer = await cliManager.rl.question('Would you like to switch to another provider? (y/n): ')
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
              // Get available providers and offer switching
              const aiService = this.app.serviceManager.getAIProviderService()
              if (aiService) {
                const availableProviders = aiService.getAvailableProviders()
                const currentProvider = aiService.getCurrentProvider()
                
                if (availableProviders.length > 1) {
                  const { execProvider } = await import('../utils/provider/execProvider.js')
                  
                  const selectedProvider = await execProvider(currentProvider.key, availableProviders, cliManager.rl)
                  
                  if (selectedProvider && selectedProvider.key !== currentProvider.key) {
                    await this.app.serviceManager.switchProvider(selectedProvider.key)
                    console.log(`${color.green}✓ Switched to ${selectedProvider.name}${color.reset}`)
                  }
                } else {
                  console.log(`${color.yellow}Only one provider available: ${availableProviders[0]?.name || 'unknown'}${color.reset}`)
                }
              }
            }
          } catch (switchError) {
            console.log(`${color.red}Error switching provider: ${switchError.message}${color.reset}`)
          }
        } else {
          // Handle other errors with standard error handler
          errorHandler.handleError(error, { context: 'ai_processing' })
        }
      }
    } finally {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
      cliManager.setSpinnerInterval(null)
      cliManager.setProcessingRequest(false)
      
      process.stdout.write('\x1B[?25h')
    }
  }

  /**
   * Find command in instructions using Repository Pattern
   */
  async findCommand(str) {
    const TRANSLATION_KEYS = [
      'RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
    ]
    
    const DOC_COMMANDS = ['doc']
    
    const arr = str.trim().split(' ')
    const commandKey = arr.shift()
    
    // Emit database lookup started
    const dbStartTime = Date.now()
    commandObserver.emit(COMMAND_EVENTS.DB_LOOKUP_STARTED, {
      commandKey: commandKey
    })
    
    try {
      const repository = getCommandRepository()
      
      // Get commands count for metrics
      const allCommands = await repository.getAllCommands()
      const commandsCount = Object.keys(allCommands).length
      
      // Find command by keyword
      const foundCommand = await repository.findByKeyword(commandKey, { exactMatch: true })
      
      // Emit database lookup completed
      commandObserver.emit(COMMAND_EVENTS.DB_LOOKUP_COMPLETED, {
        found: !!foundCommand,
        commandsCount: commandsCount,
        lookupTime: Date.now() - dbStartTime
      })
      
      if (foundCommand) {
        const restString = arr.join(' ')
        const isTranslation = TRANSLATION_KEYS.includes(foundCommand.id)
        const isDocCommand = foundCommand.id === 'DOC' || DOC_COMMANDS.includes(commandKey)
        
        const hasMultipleModels = foundCommand.models && 
                                  Array.isArray(foundCommand.models) && 
                                  foundCommand.models.length > 1
        const isMultiProvider = hasMultipleModels
        
        const hasUrl = restString && (restString.startsWith('http') || restString.includes('://'))
        
        // Emit command found event
        commandObserver.emit(COMMAND_EVENTS.DB_COMMAND_FOUND, {
          commandKey: commandKey,
          commandType: foundCommand.id,
          isTranslation: isTranslation,
          hasMultipleModels: hasMultipleModels,
          hasUrl: hasUrl,
          modelCount: foundCommand.models?.length || 0
        })
        
        return {
          fullInstruction: `${foundCommand.instruction}: ${restString}`,
          isTranslation,
          isDocCommand,
          isMultiProvider,
          hasUrl,
          originalInput: str,
          commandKey,
          commandType: foundCommand.id,
          targetContent: restString,
          instruction: foundCommand.instruction,
          models: foundCommand.models || null,
          cache_enabled: foundCommand.cache_enabled !== undefined ? foundCommand.cache_enabled : true
        }
      }
      
      return null
      
    } catch (error) {
      logger.error(`AIProcessor: Failed to find command ${commandKey}: ${error.message}`)
      
      // Emit database lookup completed with error
      commandObserver.emit(COMMAND_EVENTS.DB_LOOKUP_COMPLETED, {
        found: false,
        commandsCount: 0,
        lookupTime: Date.now() - dbStartTime,
        error: error.message
      })
      
      return null
    }
  }

  /**
   * Process MCP input (extracted from original logic)
   */
  async processMCPInput(input, command = null) {
    try {
      if (!intentDetector.requiresMCP(input)) {
        return null
      }
      
      const intents = intentDetector.detectIntent(input)
      if (intents.length === 0) {
        return null
      }
      
      const routing = intentDetector.getMCPRouting(intents)
      if (!routing) {
        return null
      }
      
      logger.debug(`MCP routing: ${routing.server}/${routing.tool}`)
      
      const mcpData = await this.callMCPServer(routing.server, routing.tool, routing.args)
      
      if (!mcpData) {
        return null
      }
      
      const formattedData = this.formatMCPData(mcpData, intents[0], command)
      
      const isRussianInput = /[а-яё]/i.test(input)
      const language = isRussianInput ? 'русском' : 'English'
      const languageInstruction = isRussianInput 
        ? 'ОБЯЗАТЕЛЬНО отвечай на русском языке!'
        : 'MUST respond in English!'
      
      if ((intents[0].type === 'webpage' || intents[0].type === 'follow_link') && formattedData.content) {
        const enhancedInput = `${input}\\n\\nContent from webpage:\\n${formattedData.text}\\n\\n${languageInstruction}`
        return {
          enhancedInput,
          showMCPData: true,
          mcpData: formattedData
        }
      }
      
      const enhancedInput = `${input}\\n\\n[Additional context from web search/fetch:]\\n${formattedData.text}\\n\\n${languageInstruction}`
      
      return {
        enhancedInput,
        mcpData: formattedData
      }
      
    } catch (error) {
      logger.error('MCP processing failed:', error)
      return null
    }
  }

  /**
   * Call MCP server (extracted from original logic)
   */
  async callMCPServer(serverName, toolName, args) {
    try {
      logger.debug(`Calling MCP: ${serverName}/${toolName}`)
      
      if (serverName === 'fetch') {
        return await fetchMCPServer.callTool(toolName, args)
      } else if (serverName === 'web-search') {
        return await searchMCPServer.callTool(toolName, args)
      }
      
      return await mcpManager.callTool(serverName, toolName, args)
      
    } catch (error) {
      logger.error(`MCP call failed: ${error.message}`)
      throw error
    }
  }

  /**
   * Format MCP data (extracted from original logic)
   */
  formatMCPData(mcpData, intent, command = null) {
    switch (intent.type) {
      case 'webpage':
      case 'follow_link':
        let linksText = ''
        if (mcpData.links && mcpData.links.length > 0 && !(command && command.isTranslation)) {
          linksText = '\\n\\nRelated links found in this article:\\n' + 
            mcpData.links.map((link, index) => `${index + 1}. ${link.text} [web]`).join('\\n')
        }
        
        let followedFromText = ''
        if (mcpData.followedFrom) {
          followedFromText = `\\n\\n[Followed from: ${mcpData.followedFrom.linkText}]`
        }
        
        return {
          type: 'webpage',
          url: mcpData.url,
          title: mcpData.title,
          content: mcpData.content,
          links: mcpData.links || [],
          followedFrom: mcpData.followedFrom,
          summary: `${mcpData.title}\\n\\n${mcpData.content.substring(0, 500)}${mcpData.content.length > 500 ? '...' : ''}`,
          text: `Website: ${mcpData.url}\\nTitle: ${mcpData.title}${followedFromText}\\nContent: ${mcpData.content}${linksText}`
        }
      
      case 'search':
        const searchResults = mcpData.results || []
        const searchSummary = searchResults.map(result => 
          `• ${result.title}\\n  ${result.content}\\n  ${result.url}`
        ).join('\\n\\n')
        
        return {
          type: 'search',
          query: mcpData.query,
          results: searchResults,
          summary: `Search Results: ${mcpData.query}\\n\\n${searchSummary}`,
          text: `Search results for "${mcpData.query}":\\n\\n${searchSummary}`
        }
      
      default:
        return {
          type: 'unknown',
          text: JSON.stringify(mcpData, null, 2)
        }
    }
  }

  /**
   * Open link in browser (extracted from original logic)
   */
  async openLinkInBrowser(linkNumber) {
    try {
      if (!fetchMCPServer.recentExtractions || fetchMCPServer.recentExtractions.size === 0) {
        return `${color.red}Error: No recent extractions found. Please extract content from a webpage first.${color.reset}`
      }
      
      const entries = Array.from(fetchMCPServer.recentExtractions.entries())
      const mostRecentExtraction = entries[entries.length - 1][1]
      
      if (!mostRecentExtraction.links || mostRecentExtraction.links.length === 0) {
        return `${color.red}Error: No links found in recent extraction.${color.reset}`
      }
      
      if (linkNumber > mostRecentExtraction.links.length) {
        return `${color.red}Error: Link ${linkNumber} does not exist. Available links: 1-${mostRecentExtraction.links.length}${color.reset}`
      }
      
      const link = mostRecentExtraction.links[linkNumber - 1]
      
      await openInBrowser(link.url)
      
      return `${color.green}✓${color.reset} Opened link ${linkNumber} in browser: ${color.cyan}${link.text}${color.reset}\\n${color.grey}URL: ${link.url}${color.reset}`
      
    } catch (error) {
      logger.error(`Failed to open link in browser: ${error.message}`)
      return `${color.red}Error: Failed to open link in browser. ${error.message}${color.reset}`
    }
  }
}