import { color } from '../../config/color.js'
import { createInteractiveMenu } from '../interactive_menu.js'
import { createSelectionTitle } from '../menu-helpers.js'

export const execProvider = async (currentProviderKey, providers, rl) => {
  console.log(
    color.reset +
      'Current provider: ' +
      color.cyan +
      currentProviderKey +
      color.reset + '\n'
  )

  // Create provider options with health status indicators
  const providerOptions = providers.map(provider => {
    const healthIcon = provider.isHealthy ? '✓' : '✗'
    const healthColor = provider.isHealthy ? color.green : color.red
    const status = provider.isCurrent ? ' (current)' : ''
    return `${healthColor}${healthIcon}${color.reset} ${provider.name}${status}`
  })
  
  const currentProviderIndex = providers.findIndex(provider => provider.isCurrent)
  
  const selectedIndex = await createInteractiveMenu(
    createSelectionTitle('provider', providers.length),
    providerOptions,
    currentProviderIndex >= 0 ? currentProviderIndex : 0
  )
  
  if (selectedIndex === -1) {
    console.log(
      color.reset +
        'Selection cancelled. Provider remains: ' +
        color.cyan +
        currentProviderKey +
        color.reset + '\n'
    )
    return null // Return null to indicate cancellation
  }
  
  const selectedProvider = providers[selectedIndex]
  
  if (!selectedProvider.isHealthy) {
    console.log(
      color.red +
        'Error: Selected provider is unhealthy and cannot be used.' +
        color.reset + '\n'
    )
    return null
  }
  
  console.log(
    color.reset +
      'Your provider is now: ' +
      color.cyan +
      selectedProvider.name +
      color.reset
  )
  
  return selectedProvider
}