#!/usr/bin/env node

import { SimpleCommandHandler } from './handlers/simple-command-handler.js'
import { getInstructionsFromDatabase } from './utils/migration.js'

// Mock AIApplication for testing
const mockApp = {
  aiState: {
    selectedProviderKey: 'deepseek',
    model: 'deepseek-chat'
  },
  
  findCommand(input) {
    const instructions = getInstructionsFromDatabase()
    
    for (const [id, command] of Object.entries(instructions)) {
      for (const key of command.key) {
        if (input.startsWith(key + ' ')) {
          const targetContent = input.substring(key.length + 1).trim()
          if (targetContent) {
            return {
              commandKey: key,
              instruction: command.instruction,
              fullInstruction: `${command.instruction}: ${targetContent}`,
              targetContent,
              originalInput: input,
              isTranslation: ['aa', 'rr', 'cc', 'аа', 'сс'].includes(key),
              isMultiProvider: false,
              isMultiCommand: command.models && command.models.length > 1,
              models: command.models || null,
              hasUrl: /https?:\/\//.test(targetContent)
            }
          }
        }
      }
    }
    return null
  },

  showHelp() {
    return `Available commands:
- help: show this help
- exit/quit: exit application  
- status: show current provider/model status
- provider: show/change provider
- aa <text>: translate to English (multi-model)
- gg <text>: check grammar (multi-model)
- rr <text>: translate to Russian`
  }
}

async function testHandler() {
  console.log('Testing SimpleCommandHandler...\n')
  
  const handler = new SimpleCommandHandler(mockApp)
  
  const testCases = [
    'help',
    'status', 
    'exit',
    'aa hello world',
    'gg this is wrong grammar',
    'rr привет мир',
    'random chat message'
  ]
  
  for (const input of testCases) {
    console.log(`Testing: "${input}"`)
    
    const context = { input }
    const canHandle = await handler.canHandle(context)
    console.log(`  Can handle: ${canHandle}`)
    
    if (canHandle) {
      try {
        const result = await handler.handle(context)
        console.log(`  Result:`, {
          handled: result.handled,
          type: result.type,
          commandKey: result.commandKey || 'N/A'
        })
        
        if (result.type === 'system' && input !== 'exit') {
          console.log(`  Output: ${result.result}`)
        }
      } catch (error) {
        console.log(`  Error: ${error.message}`)
      }
    }
    
    console.log()
  }
}

testHandler().catch(console.error)