#!/usr/bin/env node

import { ServiceManager } from './services/service-manager.js'

// Mock minimal app for testing
const mockApp = {
  aiState: {
    provider: null,
    models: [],
    model: '',
    selectedProviderKey: ''
  }
}

async function testServices() {
  console.log('Testing Service Architecture...\n')
  
  const serviceManager = new ServiceManager(mockApp)
  
  try {
    // Initialize services
    console.log('1. Initializing services...')
    await serviceManager.initialize()
    
    // Test input processing
    console.log('\n2. Testing input processing...')
    const inputService = serviceManager.getInputProcessingService()
    const inputResult = await inputService.processInput('aa hello $$ --force')
    console.log('Input processing result:', {
      original: inputResult.originalInput,
      processed: inputResult.processedInput,
      flags: inputResult.flags,
      hasClipboard: inputResult.metadata.hasClipboard
    })
    
    // Test command processing
    console.log('\n3. Testing command processing...')
    const commandService = serviceManager.getCommandProcessingService()
    
    const testCommands = ['help', 'aa hello world', 'gg this text', 'unknown command']
    for (const cmd of testCommands) {
      const command = await commandService.findCommand(cmd)
      console.log(`Command "${cmd}":`, command ? {
        type: command.type,
        name: command.name || command.commandKey,
        isMultiCommand: command.isMultiCommand
      } : 'Not found')
    }
    
    // Test AI provider service
    console.log('\n4. Testing AI provider service...')
    const aiService = serviceManager.getAIProviderService()
    const providers = aiService.getAvailableProviders()
    console.log(`Available providers: ${providers.length}`)
    providers.forEach(p => {
      console.log(`  - ${p.name} (${p.key}): ${p.models.length} models, healthy: ${p.isHealthy}`)
    })
    
    const currentProvider = aiService.getCurrentProvider()
    console.log(`Current provider: ${currentProvider.key} with model: ${currentProvider.model}`)
    
    // Test service status
    console.log('\n5. Service status...')
    const status = serviceManager.getServiceStatus()
    console.log(`Overall health: ${status.overallHealth}`)
    console.log(`Services initialized: ${status.totalServices}`)
    console.log(`Uptime: ${status.uptime}ms`)
    
    // Test service stats
    console.log('\n6. Service statistics...')
    const stats = serviceManager.getServiceStats()
    console.log('Service stats:', Object.keys(stats.services))
    
    // Test health check
    console.log('\n7. Health check...')
    const healthCheck = await serviceManager.performHealthCheck()
    console.log(`Health check overall: ${healthCheck.overall}`)
    if (healthCheck.issues.length > 0) {
      console.log('Issues:', healthCheck.issues)
    }
    
    console.log('\n✅ All service tests completed successfully!')
    
  } catch (error) {
    console.error('❌ Service test failed:', error)
  } finally {
    // Cleanup
    await serviceManager.dispose()
    console.log('\n🧹 Services disposed')
  }
}

testServices().catch(console.error)