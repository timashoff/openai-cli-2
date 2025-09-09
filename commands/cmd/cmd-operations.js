/**
 * cmd-operations.js - Command management system with modern menu-based UX
 * Functional object (NO CLASSES per CLAUDE.md!)
 * New modular implementation based on cmd-command_legacy.js
 */
import { createNavigationMenu, createTextInput } from '../../utils/interactive_menu_new.js'
import { createToggleMenu } from '../../utils/toggle-menu.js'
import { createSelectionTitle } from '../../utils/menu-helpers.js'
import { outputHandler } from '../../core/output-handler.js'
import { color } from '../../config/color.js'
import { databaseCommandService } from '../../services/DatabaseCommandService.js'
import { createSpinner } from '../../utils/spinner.js'
import { APP_CONSTANTS } from '../../config/constants.js'
import { getAllSystemCommandNames } from '../../utils/system-commands.js'

/**
 * Collection editing actions
 */
const COLLECTION_ACTIONS = {
  ADD: 'Add',
  REMOVE: 'Remove',
  REMOVE_ALL: 'Remove all',
  BACK: 'Back'
}

/**
 * Clean input helper
 */
function getCleanInput(input) {
  return input?.trim() || null
}

/**
 * Configuration objects for different collection types
 */
const COLLECTION_CONFIGS = {
  keys: {
    fieldName: 'key',
    displayName: 'Keys',
    addFlow: addKeyWithValidation,
    removeFlow: removeKeysInteractive,
    displayItems: (items) => items.join(', ') || 'no keys',
    validateItem: validateKey
  },

  models: {
    fieldName: 'models',
    displayName: 'Models',
    addFlow: addModelProviderFlow,
    removeFlow: removeModelsToggle,
    displayItems: (items) => {
      if (items.length === 0) return 'system default'
      if (items.length === 1) return items[0].model || String(items[0])
      return items.length.toString()
    },
    validateItem: null
  }
}

/**
 * Main menu actions
 */
const mainMenuActions = [
  { name: 'Add command', action: handleAddCommand },
  { name: 'Edit command', action: handleEditCommand },
  { name: 'List commands', action: handleListCommands },
  { name: 'Delete command', action: handleDeleteCommand },
  { name: 'Exit', action: null }
]

/**
 * Base CMD Command functional object (NO CLASS!)
 */
export const BaseCmdCommand = {
  async execute(args = [], context = {}) {
    let escHandlerId = null
    let escapeResolve = null
    let isCancelled = false

    try {
      // Register custom ESC handler for cmd command
      if (context.esc && context.esc.register) {
        escHandlerId = context.esc.register(() => {
          isCancelled = true
          if (escapeResolve) {
            console.log()
            escapeResolve('CANCELLED')
            escapeResolve = null
          }
        }, 'CMD command menu navigation')
      }

      const menuOptions = mainMenuActions.map(item => item.name)

      while (true && !isCancelled) {
        const escapePromise = new Promise(resolve => {
          escapeResolve = resolve
        })

        const result = await Promise.race([
          createNavigationMenu(
            createSelectionTitle('action', mainMenuActions.length - 1),
            menuOptions,
            0,
            context
          ),
          escapePromise
        ])

        escapeResolve = null

        if (result === 'CANCELLED' || isCancelled) {
          return null
        }

        const selectedIndex = result

        if (selectedIndex === -1 || selectedIndex === 4) {
          return null
        }

        try {
          const selectedAction = mainMenuActions[selectedIndex]
          if (selectedAction.action) {
            await selectedAction.action(context)
          }
        } catch (error) {
          console.log(outputHandler.formatError(`Operation failed: ${error.message}`))
        }
      }

      return null

    } catch (error) {
      return outputHandler.formatError(`Command management failed: ${error.message}`)
    } finally {
      if (escHandlerId && context.esc && context.esc.unregister) {
        context.esc.unregister(escHandlerId)
      }
    }
  }
}

/**
 * Handle adding new command
 */
async function handleAddCommand(context) {
  try {
    console.log(color.cyan + '\n=== Add New Command ===' + color.reset)

    const commandData = {
      name: '',
      key: [],
      description: '',
      instruction: '',
      models: [],
      isCached: false
    }

    const success = await editCommandFields(commandData, context, 'create')

    if (success) {
      const spinner = createSpinner('Adding command...')
      spinner.start()

      const commandId = generateCommandId(commandData.name)
      databaseCommandService.saveCommand(commandId, commandData)

      spinner.stop('success')
      console.log(outputHandler.formatSuccess(`✓ Command "${commandData.name}" created successfully!`))
    } else {
      console.log(color.yellow + 'Command creation cancelled - no changes made' + color.reset + '\n')
    }

  } catch (error) {
    throw error
  }
}

/**
 * Handle editing existing command
 */
async function handleEditCommand(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(color.yellow + 'No commands available to edit.' + color.reset + '\n')
      return
    }

    const commandOptions = commandEntries.map(([id, cmd]) => {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      return `${cmd.name} [${keyText}]`
    })

    console.log(color.cyan + '\n=== Select Command to Edit ===' + color.reset)

    const selectedIndex = await createNavigationMenu(
      'Select command to edit:',
      commandOptions,
      0,
      context
    )

    if (selectedIndex === -1) {
      console.log(color.yellow + 'Edit cancelled.' + color.reset + '\n')
      return
    }

    const [commandId, existingCommand] = commandEntries[selectedIndex]

    console.log(color.cyan + `\n=== Edit Command: ${existingCommand.name} ===` + color.reset)

    const commandData = {
      name: existingCommand.name,
      key: [...existingCommand.key],
      description: existingCommand.description,
      instruction: existingCommand.instruction,
      models: [...(existingCommand.models || [])],
      isCached: existingCommand.isCached
    }

    const success = await editCommandFields(commandData, context, 'edit')

    if (success) {
      const spinner = createSpinner('Updating command...')
      spinner.start()

      databaseCommandService.saveCommand(commandId, commandData)

      spinner.stop('success')
      console.log(outputHandler.formatSuccess(`✓ Command "${commandData.name}" updated successfully!`))
    } else {
      console.log(color.yellow + `Edit cancelled - command "${existingCommand.name}" unchanged` + color.reset + '\n')
    }

  } catch (error) {
    throw error
  }
}

/**
 * Edit command fields with step-by-step menus
 */
async function editCommandFields(commandData, context, mode) {
  const originalData = JSON.parse(JSON.stringify(commandData))

  const fieldOptions = [
    { name: 'Name', action: () => editName(commandData, context) },
    { name: 'Keys', action: () => editKeys(commandData, context) },
    { name: 'Description', action: () => editDescription(commandData, context) },
    { name: 'Instruction', action: () => editInstruction(commandData, context) },
    { name: 'Models', action: () => editModels(commandData, context) },
    { name: 'Caching', action: () => editCaching(commandData, context) }
  ]

  while (true) {
    const menuOptions = generateMenuWithValues(commandData, fieldOptions, originalData)
    const selectedIndex = await createNavigationMenu(
      mode === 'create' ? 'CREATING' : 'EDITING',
      menuOptions,
      0,
      context
    )

    if (selectedIndex === -1 || selectedIndex === menuOptions.length - 1) {
      return false
    }

    if (menuOptions[selectedIndex] === '') {
      continue
    }

    if (menuOptions[selectedIndex].startsWith('Save & Exit')) {
      if (isCommandValid(commandData)) {
        return true
      } else {
        console.log(color.red + 'Please fill all required fields (Name, Keys, Description, Instruction)' + color.reset + '\n')
        continue
      }
    }

    if (selectedIndex < fieldOptions.length) {
      const selectedField = fieldOptions[selectedIndex]
      if (selectedField.action) {
        await selectedField.action()
      }
    }
  }
}

/**
 * Truncate text to maximum length with ellipsis
 */
function truncateText(text) {
  return text.length > APP_CONSTANTS.FIELD_VALUE_MAX_LENGTH ?
    text.substring(0, APP_CONSTANTS.FIELD_VALUE_MAX_LENGTH) + '...' : text
}

/**
 * Field formatters object - functional approach instead of switch case
 */
const fieldFormatters = {
  'Name': (data) => data.name ? truncateText(data.name) : color.red + 'null' + color.reset,
  'Keys': (data) => data.key.length > 0 ? data.key.join(', ') : color.red + 'null' + color.reset,
  'Description': (data) => data.description ? truncateText(data.description) : color.red + 'null' + color.reset,
  'Instruction': (data) => data.instruction ? truncateText(data.instruction) : color.red + 'null' + color.reset,
  'Models': (data) => {
    if (data.models.length === 0) return 'system (default)'
    if (data.models.length === 1) return data.models[0].model
    return data.models.length.toString()
  },
  'Caching': (data) => data.isCached ? 'yes' : 'no'
}

/**
 * Format field value for inline display using formatters object
 */
function formatFieldValue(fieldName, commandData) {
  const formatter = fieldFormatters[fieldName]
  return formatter ? formatter(commandData) : ''
}

/**
 * Check if command data has changes compared to original
 */
function hasChanges(originalData, currentData) {
  return JSON.stringify(originalData) !== JSON.stringify(currentData)
}

/**
 * Get list of changed field names using functional approach
 */
function getChangedFields(originalData, currentData) {
  const fieldCheckers = {
    'Name': (orig, curr) => orig.name !== curr.name,
    'Keys': (orig, curr) => JSON.stringify(orig.key) !== JSON.stringify(curr.key),
    'Description': (orig, curr) => orig.description !== curr.description,
    'Instruction': (orig, curr) => orig.instruction !== curr.instruction,
    'Models': (orig, curr) => JSON.stringify(orig.models) !== JSON.stringify(curr.models),
    'Caching': (orig, curr) => orig.isCached !== curr.isCached
  }

  return Object.entries(fieldCheckers)
    .filter(([fieldName, checker]) => checker(originalData, currentData))
    .map(([fieldName]) => fieldName)
}

/**
 * Generate collection actions based on item count
 */
function generateCollectionActions(items) {
  const actions = [COLLECTION_ACTIONS.ADD]

  if (items.length > 0) {
    actions.push(COLLECTION_ACTIONS.REMOVE)
  }

  if (items.length >= 2) {
    actions.push(COLLECTION_ACTIONS.REMOVE_ALL)
  }

  actions.push('')
  actions.push(COLLECTION_ACTIONS.BACK)

  return actions
}

/**
 * Universal collection editor
 */
async function editCollection(commandData, context, configKey) {
  const config = COLLECTION_CONFIGS[configKey]
  const items = commandData[config.fieldName]

  while (true) {
    const actions = generateCollectionActions(items)
    const displayTitle = `EDITING ${config.displayName} → ${commandData.name || 'Unnamed'} [${config.displayItems(items)}]`

    const selectedIndex = await createNavigationMenu(displayTitle, actions, 0, context)

    if (selectedIndex === -1 || selectedIndex === actions.length - 1) {
      break
    }

    const selectedAction = actions[selectedIndex]

    if (selectedAction === '') {
      continue
    }

    await handleCollectionAction(selectedAction, commandData, context, config)
  }
}

/**
 * Handle collection action
 */
async function handleCollectionAction(action, commandData, context, config) {
  const items = commandData[config.fieldName]

  if (action === COLLECTION_ACTIONS.ADD) {
    await config.addFlow(commandData, context)
  } else if (action === COLLECTION_ACTIONS.REMOVE) {
    await config.removeFlow(commandData, context)
  } else if (action === COLLECTION_ACTIONS.REMOVE_ALL) {
    commandData[config.fieldName] = []
    console.log(color.green + `All ${config.displayName.toLowerCase()} removed` + color.reset)
  }
}

/**
 * Generate menu options with inline field values and dynamic action buttons
 */
function generateMenuWithValues(commandData, fieldOptions, originalData = null) {
  const menuItems = []

  fieldOptions.forEach(field => {
    if (field.name === 'Save & Exit' || field.name === 'Cancel') {
      return
    }

    const fieldValue = formatFieldValue(field.name, commandData)
    const padding = ' '.repeat(Math.max(0, APP_CONSTANTS.MENU_FIELD_NAME_WIDTH - field.name.length))
    menuItems.push(`${field.name}${padding} : ${fieldValue}`)
  })

  menuItems.push('')

  if (originalData && hasChanges(originalData, commandData)) {
    const changedFields = getChangedFields(originalData, commandData)
    const changesText = changedFields.length === 1
      ? `${changedFields[0]} changed`
      : `${changedFields.join(', ')} changed`
    menuItems.push(`Save & Exit (${changesText})`)
  }
  menuItems.push('Back')

  return menuItems
}

// Field editing functions
async function editName(commandData, context) {
  console.log(color.cyan + '\n=== Edit Name ===' + color.reset)
  console.log(`Current name: ${color.blue}${commandData.name || 'Not set'}${color.reset}`)

  const newName = await createTextInput('Enter command name', commandData.name, context)

  if (newName) {
    const trimmedName = newName.trim()
    if (trimmedName !== commandData.name) {
      commandData.name = trimmedName
      if (trimmedName) {
        console.log(color.green + `Name set to: ${commandData.name}` + color.reset)
      } else {
        console.log(color.yellow + 'Name cleared' + color.reset)
      }
    } else {
      console.log(color.yellow + `Name unchanged: ${commandData.name || 'empty'}` + color.reset)
    }
  }
}

async function editKeys(commandData, context) {
  await editCollection(commandData, context, 'keys')
}

function getAllExistingKeys() {
  const allKeys = []

  allKeys.push(...getAllSystemCommandNames())

  const userCommands = databaseCommandService.getCommands()
  for (const [id, cmd] of Object.entries(userCommands)) {
    if (cmd.key && Array.isArray(cmd.key)) {
      allKeys.push(...cmd.key)
    }
  }

  return allKeys
}

function validateKey(newKey, commandData) {
  if (newKey.includes(' ')) {
    return "Key cannot contain spaces"
  }

  const allowedChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  for (const char of newKey) {
    if (!allowedChars.includes(char)) {
      return `Invalid character: ${char}`
    }
  }

  if (commandData.key.includes(newKey)) {
    return "Key already exists in this command"
  }

  const allExistingKeys = getAllExistingKeys()
  if (allExistingKeys.includes(newKey)) {
    return "Key already exists in system or other commands"
  }

  return null
}

async function addKeyWithValidation(commandData, context) {
  const newKey = await createTextInput('Enter new key', '', context)
  const keyValue = getCleanInput(newKey)

  if (!keyValue) {
    console.log(color.yellow + 'Key addition cancelled' + color.reset)
    return
  }

  const validationError = validateKey(keyValue, commandData)

  if (validationError) {
    console.log(color.red + `Invalid key: ${validationError}` + color.reset)
    return
  }

  commandData.key.push(keyValue)
  console.log(color.green + `Key "${keyValue}" added` + color.reset)
}

async function removeKeysInteractive(commandData, context) {
  if (commandData.key.length === 0) {
    console.log(color.yellow + 'No keys to remove' + color.reset)
    return
  }

  if (commandData.key.length === 1) {
    const result = await createNavigationMenu(
      `Remove key "${commandData.key[0]}"?`,
      ['Yes, remove it', 'No, keep it'],
      0,
      context
    )

    if (result === 0) {
      const removedKey = commandData.key.pop()
      console.log(color.green + `Key "${removedKey}" removed` + color.reset)
    }
    return
  }

  const result = await createToggleMenu(
    'Confirm removal - keys marked with ☓ will be deleted:',
    commandData.key,
    commandData.key,
    ['Confirm', 'Back']
  )

  if (result.action === 'confirm') {
    const keysToRemove = result.removedItems
    if (keysToRemove.length > 0) {
      commandData.key = commandData.key.filter(key => !keysToRemove.includes(key))
      console.log(color.green + `Removed ${keysToRemove.length} keys: ${keysToRemove.join(', ')}` + color.reset)
    } else {
      console.log(color.yellow + 'No keys marked for removal' + color.reset)
    }
  }
}

async function addModelProviderFlow(commandData, context) {
  const availableProviders = context.providers ? context.providers.getAvailable() : []

  if (availableProviders.length === 0) {
    console.log(color.yellow + 'No providers available' + color.reset)
    return
  }

  const providerNames = availableProviders.map(p => p.name)
  const providerIndex = await createNavigationMenu(
    'Select provider:',
    providerNames,
    0,
    context
  )

  if (providerIndex === -1) {
    console.log(color.yellow + 'Model addition cancelled' + color.reset)
    return
  }

  const selectedProvider = availableProviders[providerIndex]

  const originalProvider = context.providers.getCurrent()
  let providerModels = []

  try {
    await context.providers.switch(selectedProvider.key)
    providerModels = context.models.getAvailable()

    if (providerModels.length === 0) {
      console.log(color.yellow + `No models available for ${selectedProvider.name}` + color.reset)
      return
    }

  } finally {
    if (originalProvider && originalProvider.key !== selectedProvider.key) {
      await context.providers.switch(originalProvider.key)
    }
  }

  const modelNames = providerModels.map(model => {
    return typeof model === 'string' ? model : (model.id || model.name || String(model))
  })

  const modelIndex = await createNavigationMenu(
    `Select model from ${selectedProvider.name}:`,
    modelNames,
    0,
    context
  )

  if (modelIndex === -1) {
    console.log(color.yellow + 'Model addition cancelled' + color.reset)
    return
  }

  const selectedModelId = modelNames[modelIndex]
  const modelEntry = {
    provider: selectedProvider.key,
    model: selectedModelId
  }

  const existsIndex = commandData.models.findIndex(m => {
    return typeof m === 'object' && m.provider === modelEntry.provider && m.model === modelEntry.model
  })

  if (existsIndex !== -1) {
    console.log(color.yellow + `Model "${modelEntry.model}" from ${selectedProvider.name} already exists` + color.reset)
    return
  }

  commandData.models.push(modelEntry)
  console.log(color.green + `Added model "${modelEntry.model}" from ${selectedProvider.name}` + color.reset)
}

async function removeModelsToggle(commandData, context) {
  if (commandData.models.length === 0) {
    console.log(color.yellow + 'No models to remove' + color.reset)
    return
  }

  const modelDisplayNames = commandData.models.map(model => {
    if (typeof model === 'string') {
      return model
    } else if (typeof model === 'object' && model.provider && model.model) {
      return `${model.model} (${model.provider})`
    } else {
      return String(model)
    }
  })

  if (modelDisplayNames.length === 1) {
    const result = await createNavigationMenu(
      `Remove model "${modelDisplayNames[0]}"?`,
      ['Yes, remove it', 'No, keep it'],
      0,
      context
    )

    if (result === 0) {
      const removedModel = commandData.models.pop()
      const displayName = typeof removedModel === 'string' ? removedModel : `${removedModel.model} (${removedModel.provider})`
      console.log(color.green + `Model "${displayName}" removed` + color.reset)
    }
    return
  }

  const result = await createToggleMenu(
    'Confirm removal - models marked with ☓ will be deleted:',
    modelDisplayNames,
    modelDisplayNames,
    ['Confirm', 'Back']
  )

  if (result.action === 'confirm') {
    const modelsToRemove = result.removedItems
    if (modelsToRemove.length > 0) {
      const originalLength = commandData.models.length
      commandData.models = commandData.models.filter((model, index) => {
        return !modelsToRemove.includes(modelDisplayNames[index])
      })
      const removedCount = originalLength - commandData.models.length
      console.log(color.green + `Removed ${removedCount} models: ${modelsToRemove.join(', ')}` + color.reset)
    } else {
      console.log(color.yellow + 'No models marked for removal' + color.reset)
    }
  }
}

async function editDescription(commandData, context) {
  console.log(color.cyan + '\n=== Edit Description ===' + color.reset)
  console.log(`Current description: ${commandData.description || 'Not set'}`)

  const newDesc = await createTextInput('Enter description', commandData.description, context)

  if (newDesc) {
    const trimmedDesc = newDesc.trim()
    if (trimmedDesc !== commandData.description) {
      commandData.description = trimmedDesc
      if (trimmedDesc) {
        console.log(color.green + `Description set to: ${trimmedDesc}` + color.reset)
      } else {
        console.log(color.yellow + 'Description cleared' + color.reset)
      }
    } else {
      console.log(color.yellow + `Description unchanged: ${commandData.description || 'empty'}` + color.reset)
    }
  }
}

async function editInstruction(commandData, context) {
  console.log(color.cyan + '\n=== Edit Instruction ===' + color.reset)
  const displayInst = commandData.instruction ?
    (commandData.instruction.length > 100 ?
      commandData.instruction.substring(0, 100) + '...' :
      commandData.instruction) : 'Not set'
  console.log(`Current instruction: ${displayInst}`)

  const newInst = await createTextInput('Enter instruction', commandData.instruction, context)

  if (newInst) {
    const trimmedInst = newInst.trim()
    if (trimmedInst !== commandData.instruction) {
      commandData.instruction = trimmedInst
      if (trimmedInst) {
        console.log(color.green + `Instruction set` + color.reset)
      } else {
        console.log(color.yellow + 'Instruction cleared' + color.reset)
      }
    } else {
      console.log(color.yellow + `Instruction unchanged` + color.reset)
    }
  }
}

async function editModels(commandData, context) {
  await editCollection(commandData, context, 'models')
}

async function editCaching(commandData, context) {
  console.log(color.cyan + '\n=== Edit Caching ===' + color.reset)

  const cacheOptions = [
    `[${commandData.isCached ? '✓' : ' '}] Cached`,
    `[${!commandData.isCached ? '✓' : ' '}] No cached`
  ]

  const selectedIndex = await createNavigationMenu(
    'Select caching:',
    cacheOptions,
    commandData.isCached ? 0 : 1,
    context
  )

  if (selectedIndex !== -1) {
    commandData.isCached = selectedIndex === 0
  }
}

async function handleListCommands(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(color.yellow + 'No commands found in database.' + color.reset + '\n')
      return
    }

    console.log(color.cyan + '\n=== Available Commands ===' + color.reset)

    for (const [id, cmd] of commandEntries) {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      const cacheStatus = cmd.isCached ? color.green + ' (cached)' + color.reset : ''
      const commandName = cmd.name || 'Unnamed Command'

      console.log(`${color.blue}${commandName}${color.reset} [${color.yellow}${keyText}${color.reset}]${cacheStatus}`)
      console.log(`  ${cmd.description}`)
      console.log('')
    }

    console.log(color.grey + '\nPress Enter to continue...' + color.reset)
    await createTextInput('Press Enter to continue', '', context)

  } catch (error) {
    console.log(outputHandler.formatError(`Error listing commands: ${error.message}`))
  }
}

async function handleDeleteCommand(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(color.yellow + 'No commands available to delete.' + color.reset + '\n')
      return
    }

    const commandOptions = commandEntries.map(([id, cmd]) => {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      return `${cmd.name} [${keyText}]`
    })

    console.log(color.red + '\n=== Delete Command ===' + color.reset)

    const selectedIndex = await createNavigationMenu(
      'Select command to delete:',
      commandOptions,
      0,
      context
    )

    if (selectedIndex === -1) {
      console.log(color.yellow + 'Delete cancelled.' + color.reset + '\n')
      return
    }

    const [commandId, command] = commandEntries[selectedIndex]

    console.log(color.red + `\nAre you sure you want to delete "${command.name}"?` + color.reset)
    const confirmation = await createNavigationMenu(
      'Confirm deletion:',
      ['Yes, delete it', 'No, cancel'],
      1,
      context
    )

    if (confirmation === -1 || confirmation === 1) {
      console.log(color.yellow + 'Delete cancelled.' + color.reset + '\n')
      return
    }

    const spinner = createSpinner('Deleting command...')
    spinner.start()

    databaseCommandService.deleteCommand(commandId)

    spinner.stop('success')
    console.log(outputHandler.formatSuccess(`✓ Command "${command.name}" deleted successfully!`))

  } catch (error) {
    throw error
  }
}

function isCommandValid(commandData) {
  return commandData.name &&
         commandData.key.length > 0 &&
         commandData.description &&
         commandData.instruction
}

function generateCommandId(name) {
  const allowedChars = 'abcdefghijklmnopqrstuvwxyz0123456789_'
  let cleanName = ''

  for (const char of name.toLowerCase()) {
    if (allowedChars.includes(char)) {
      cleanName += char
    } else {
      cleanName += '_'
    }
  }

  const parts = cleanName.split('_').filter(part => part.length > 0)
  const baseId = parts.join('_')

  const timestamp = Date.now().toString().slice(-6)
  return `${baseId}_${timestamp}`
}
