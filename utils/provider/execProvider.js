import { color } from '../../config/color.js'
import { createInteractiveMenu } from '../interactive_menu.js'
import { createSelectionTitle } from '../menu-helpers.js'

export const execProvider = async (currentProviderKey, providers, rl) => {
  // Create clean provider options
  const providerOptions = providers.map(provider => {
    const status = provider.isCurrent ? ' (current)' : ''
    return `${provider.name}${status}`
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
  
  // Don't show "Your provider is now" - spinner will show the actual result
  return selectedProvider
}