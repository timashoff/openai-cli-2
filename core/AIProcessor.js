/**
 * AIProcessor - Extracted AI processing logic from monolith decomposition
 * Handles AI input processing, MCP integration, streaming, caching, and provider management
 */
import { APP_CONSTANTS, UI_SYMBOLS } from '../config/constants.js'
import { getClipboardContent, getElapsedTime, clearTerminalLine, showStatus } from '../utils/index.js'
import { sanitizeString, validateString } from '../utils/validation.js'
import { configManager } from '../config/config-manager.js'
import { StreamProcessor } from '../utils/stream-processor.js'
import { getCommandsFromDB } from '../utils/database-manager.js'
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

export class AIProcessor {
  constructor(app) {
    this.app = app
  }

  /**
   * Process AI input (extracted from original business logic)
   */
  async processAIInput(input, cliManager) {
    // Critical business logic - keep original implementation
    let interval
    let startTime
    const originalInput = input

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
    const command = this.findCommand(input)

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
    if (command && command.models && Array.isArray(command.models) && command.models.length > 1 && !forceRequest) {
      try {
        // Create callback for provider headers and output
        const onProviderComplete = async (result, index, provider, isFirst) => {
          if (isFirst && index === 0) {
            // Show handler info for first provider
            console.log(`[Handler: ${command.commandKey}]\n`)
          }
          
          // Show provider header
          const providerLabel = provider.model 
            ? `${provider.name} (${provider.model})`
            : provider.name
          console.log(`${color.cyan}${providerLabel}:${color.reset}`)
        }
        
        // Let multiCommandProcessor handle output with proper formatting
        await multiCommandProcessor.executeMultiple(
          finalInput,
          controller.signal,
          command.models,
          null, // defaultModel
          onProviderComplete
        )
        
        return
      } catch (error) {
        errorHandler.handleError(error, { context: 'multi_model_processing' })
        return
      }
    }

    // Standard single-provider translation cache check
    if (command && command.isTranslation && !forceRequest && cache.has(cacheKey)) {
      console.log(`${color.yellow}[from cache]${color.reset}`)
      process.stdout.write(cache.get(cacheKey) + '\\n')
      return
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

      const stream = await this.app.aiState.provider.createChatCompletion(this.app.aiState.model, messages, {
        stream: true,
        signal: controller.signal
      })

      const streamProcessor = new StreamProcessor(this.app.aiState.selectedProviderKey)
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
        if (command && command.isTranslation) {
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
        errorHandler.handleError(error, { context: 'ai_processing' })
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
   * Find command in instructions (extracted from original logic)
   */
  findCommand(str) {
    const TRANSLATION_KEYS = [
      'RUSSIAN', 'ENGLISH', 'CHINESE', 'PINYIN', 'TRANSCRIPTION', 'HSK', 'HSK_SS'
    ]
    
    const DOC_COMMANDS = ['doc']
    
    const arr = str.trim().split(' ')
    const commandKey = arr.shift()
    
    const INSTRUCTIONS = getCommandsFromDB()
    for (const prop in INSTRUCTIONS) {
      if (INSTRUCTIONS[prop].key.includes(commandKey)) {
        const restString = arr.join(' ')
        const isTranslation = TRANSLATION_KEYS.includes(prop)
        const isDocCommand = prop === 'DOC' || DOC_COMMANDS.includes(commandKey)
        
        const hasMultipleModels = INSTRUCTIONS[prop].models && 
                                  Array.isArray(INSTRUCTIONS[prop].models) && 
                                  INSTRUCTIONS[prop].models.length > 1
        const isMultiProvider = hasMultipleModels
        
        const hasUrl = restString && (restString.startsWith('http') || restString.includes('://'))
        
        return {
          fullInstruction: `${INSTRUCTIONS[prop].instruction}: ${restString}`,
          isTranslation,
          isDocCommand,
          isMultiProvider,
          hasUrl,
          originalInput: str,
          commandKey,
          commandType: prop,
          targetContent: restString,
          instruction: INSTRUCTIONS[prop].instruction,
          models: INSTRUCTIONS[prop].models || null
        }
      }
    }
    return null
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