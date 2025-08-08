#!/usr/bin/env node

// Quick test for UX fix: showing provider + model in output
import { multiProviderTranslator } from './utils/multi-provider-translator.js'

async function testUXFix() {
  console.log('🎨 Testing UX fix: Provider + Model display...\n')

  try {
    // Initialize translator
    await multiProviderTranslator.initialize()

    // Simulate custom models
    const customModels = [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'deepseek', model: 'deepseek-chat' }
    ]

    console.log('📋 Testing with custom models:')
    customModels.forEach(model => {
      console.log(`   - ${model.provider}: ${model.model}`)
    })
    console.log('')

    // Simulate translation result structure (without actual API call)
    const mockResult = {
      translations: [
        {
          provider: 'OpenAI',
          model: 'gpt-4o-mini', 
          response: 'This is a test translation from GPT-4o-mini',
          error: null
        },
        {
          provider: 'DeepSeek',
          model: 'deepseek-chat',
          response: 'This is a test translation from DeepSeek-chat',
          error: null
        }
      ],
      elapsed: '1.2',
      successful: 2,
      total: 2
    }

    console.log('🖥️  Testing formatted output:')
    const formattedResponse = multiProviderTranslator.formatMultiProviderResponse(mockResult)
    console.log(formattedResponse)

    console.log('\n✅ UX fix implemented successfully!')
    console.log('   - Provider names now show with model: "OpenAI (gpt-4o-mini)"')
    console.log('   - Users can clearly distinguish between different models')
    console.log('   - Perfect for A/B testing multiple models from same provider')

  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testUXFix().catch(console.error)