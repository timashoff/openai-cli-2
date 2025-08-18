#!/usr/bin/env node

import { ServiceManager } from '../services/service-manager.js'

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
    
    // Command processing now uses database directly (service disabled)
    console.log('\n3. Command processing uses database directly (simplified)...')
    
    // Test AI provider service
    console.log('\n4. Testing AI provider service...')
    const aiService = serviceManager.getAIProviderService()
    const providers = aiService.getAvailableProviders()
    console.log(`Available providers: ${providers.length}`)
    providers.forEach(p => {
      console.log(`  - ${p.name} (${p.key}): ${p.models.length} models`)
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
    
    // Health checks removed - simplified provider system
    
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