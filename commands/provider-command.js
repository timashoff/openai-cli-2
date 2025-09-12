import { createNavigationMenu } from '../utils/interactive_menu.js'
import { createSpinner } from '../utils/spinner.js'
import { outputHandler } from '../core/output-handler.js'

export const ProviderCommand = {
  async execute(args = [], context = {}) {
    try {
      // Use clean interfaces instead of direct API_PROVIDERS access
      const availableProviders = context.providers.getAvailable()

      if (availableProviders.length === 0) {
        return outputHandler.formatWarning('No providers available - check your API keys')
      }

      if (availableProviders.length === 1) {
        return outputHandler.formatWarning(`Only one provider available: ${availableProviders[0].name}`)
      }

      // Get current provider through clean interface (NO GOD OBJECT!)
      const currentProvider = context.providers.getCurrent()
      const currentProviderKey = currentProvider?.key

      // Mark current provider
      availableProviders.forEach(provider => {
        provider.isCurrent = provider.key === currentProviderKey
      })

      // Handle direct provider specification: "provider openai"
      if (args.length > 0) {
        const targetProviderName = args[0].toLowerCase()
        const targetProvider = availableProviders.find(provider => 
          provider.key.toLowerCase() === targetProviderName ||
          provider.name.toLowerCase() === targetProviderName
        )

        if (!targetProvider) {
          const availableNames = availableProviders.map(p => p.key).join(', ')
          return outputHandler.formatError(`Provider '${targetProviderName}' not found. Available: ${availableNames}`)
        }

        if (targetProvider.isCurrent) {
          return outputHandler.formatWarning(`Already using ${targetProvider.name}`)
        }

        // Switch to specified provider through clean interface with spinner
        const spinner = createSpinner('Switching provider...')
        spinner.start()
        try {
          await context.providers.switch(targetProvider.key)
          spinner.stop('success')
          return outputHandler.formatSuccess(`Switched to ${targetProvider.name}`)
        } catch (error) {
          spinner.stop('error')
          throw error
        }
      }

      // Interactive provider selection
      const providerOptions = availableProviders.map(p => {
        const indicator = p.isCurrent ? ' (current)' : ''
        return `${p.name}${indicator}`
      })
      
      const selectedIndex = await createNavigationMenu('Select Provider:', providerOptions, 0, context)

      // Handle user cancellation (ESC)
      if (selectedIndex === -1) {
        return null
      }
      
      const selectedProvider = availableProviders[selectedIndex]

      // Check if user selected the same provider
      if (selectedProvider.key === currentProviderKey) {
        return outputHandler.formatWarning(`Already using ${selectedProvider.name}`)
      }

      // Perform the switch through clean interface with spinner
      const spinner = createSpinner('Switching provider...')
      spinner.start()
      try {
        await context.providers.switch(selectedProvider.key)
        spinner.stop('success')
        return outputHandler.formatSuccess(`Switched to ${selectedProvider.name}`)
      } catch (error) {
        spinner.stop('error')
        throw error
      }

    } catch (error) {
      return outputHandler.formatError(error.message)
    }
  }
}