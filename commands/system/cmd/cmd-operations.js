import {
  createNavigationMenu,
  createTextInput,
} from '../ui/interactive-menu.js'
import { createToggleMenu } from './toggle-menu.js'
import { createSelectionTitle } from './menu-helpers.js'
import { outputHandler } from '../../../core/print/index.js'
import { ANSI } from '../../../config/ansi.js'
import { databaseCommandService } from '../../../services/database-command-service.js'
import { createSpinner } from '../../../utils/spinner.js'
import { APP_CONSTANTS } from '../../../config/constants.js'
import { getAllSystemCommandNames } from '../../../utils/system-commands.js'

const COLLECTION_ACTIONS = {
  ADD: 'Add',
  REMOVE: 'Remove',
  REMOVE_ALL: 'Remove all',
  BACK: 'Back',
}

function getCleanInput(input) {
  return input?.trim() || null
}

const COLLECTION_CONFIGS = {
  keys: {
    fieldName: 'key',
    displayName: 'Keys',
    addFlow: addKeyWithValidation,
    removeFlow: removeKeysInteractive,
    displayItems: (items) => items.join(', ') || 'no keys',
    validateItem: validateKey,
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
    validateItem: null,
  },
}

const mainMenuActions = [
  { name: 'Add command', action: handleAddCommand },
  { name: 'Edit command', action: handleEditCommand },
  { name: 'List commands', action: handleListCommands },
  { name: 'Delete command', action: handleDeleteCommand },
  { name: 'Exit', action: null },
]

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

      const menuOptions = mainMenuActions.map((item) => item.name)

      while (true && !isCancelled) {
        const escapePromise = new Promise((resolve) => {
          escapeResolve = resolve
        })

        const result = await Promise.race([
          createNavigationMenu(
            createSelectionTitle('action', mainMenuActions.length - 1),
            menuOptions,
            0,
            context,
          ),
          escapePromise,
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
          console.log(
            outputHandler.formatError(`Operation failed: ${error.message}`),
          )
        }
      }

      return null
    } catch (error) {
      return outputHandler.formatError(
        `Command management failed: ${error.message}`,
      )
    } finally {
      if (escHandlerId && context.esc && context.esc.unregister) {
        context.esc.unregister(escHandlerId)
      }
    }
  },
}

async function handleAddCommand(context) {
  try {
    console.log(ANSI.COLORS.CYAN + '\n=== Add New Command ===' + ANSI.COLORS.RESET)

    const commandData = {
      name: '',
      key: [],
      description: '',
      instruction: '',
      models: [],
    }

    const success = await editCommandFields(commandData, context, 'create')

    if (success) {
      const spinner = createSpinner('Adding command...')
      spinner.start()

      const commandId = generateCommandId(commandData.name)
      databaseCommandService.saveCommand(commandId, commandData)

      spinner.stop('success')
      console.log(
        outputHandler.formatSuccess(
          `✓ Command "${commandData.name}" created successfully!`,
        ),
      )
    } else {
      console.log(
        ANSI.COLORS.YELLOW +
          'Command creation cancelled - no changes made' +
          ANSI.COLORS.RESET +
          '\n',
      )
    }
  } catch (error) {
    throw error
  }
}

async function handleEditCommand(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(
        ANSI.COLORS.YELLOW + 'No commands available to edit.' + ANSI.COLORS.RESET + '\n',
      )
      return
    }

    const commandOptions = commandEntries.map(([id, cmd]) => {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      return `${cmd.name} [${keyText}]`
    })

    console.log(ANSI.COLORS.CYAN + '\n=== Select Command to Edit ===' + ANSI.COLORS.RESET)

    const selectedIndex = await createNavigationMenu(
      'Select command to edit:',
      commandOptions,
      0,
      context,
    )

    if (selectedIndex === -1) {
      console.log(ANSI.COLORS.YELLOW + 'Edit cancelled.' + ANSI.COLORS.RESET + '\n')
      return
    }

    const [commandId, existingCommand] = commandEntries[selectedIndex]

    console.log(
      ANSI.COLORS.CYAN +
        `\n=== Edit Command: ${existingCommand.name} ===` +
        ANSI.COLORS.RESET,
    )

    const commandData = {
      name: existingCommand.name,
      key: [...existingCommand.key],
      description: existingCommand.description,
      instruction: existingCommand.instruction,
      models: existingCommand.models,
    }

    const success = await editCommandFields(commandData, context, 'edit')

    if (success) {
      const spinner = createSpinner('Updating command...')
      spinner.start()

      databaseCommandService.saveCommand(commandId, commandData)

      spinner.stop('success')
      console.log(
        outputHandler.formatSuccess(
          `✓ Command "${commandData.name}" updated successfully!`,
        ),
      )
    } else {
      console.log(
        ANSI.COLORS.YELLOW +
          `Edit cancelled - command "${existingCommand.name}" unchanged` +
          ANSI.COLORS.RESET +
          '\n',
      )
    }
  } catch (error) {
    throw error
  }
}

async function editCommandFields(commandData, context, mode) {
  const originalData = JSON.parse(JSON.stringify(commandData))

  const fieldOptions = [
    { name: 'Name', action: () => editName(commandData, context) },
    { name: 'Keys', action: () => editKeys(commandData, context) },
    {
      name: 'Description',
      action: () => editDescription(commandData, context),
    },
    {
      name: 'Instruction',
      action: () => editInstruction(commandData, context),
    },
    { name: 'Models', action: () => editModels(commandData, context) },
  ]

  while (true) {
    const menuOptions = generateMenuWithValues(
      commandData,
      fieldOptions,
      originalData,
    )
    const selectedIndex = await createNavigationMenu(
      mode === 'create' ? 'CREATING' : 'EDITING',
      menuOptions,
      0,
      context,
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
        console.log(
          ANSI.COLORS.RED +
            'Please fill all required fields (Name, Keys, Description, Instruction)' +
            ANSI.COLORS.RESET +
            '\n',
        )
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

function truncateText(text) {
  return text.length > APP_CONSTANTS.FIELD_VALUE_MAX_LENGTH
    ? text.substring(0, APP_CONSTANTS.FIELD_VALUE_MAX_LENGTH) + '...'
    : text
}

const fieldFormatters = {
  Name: (data) =>
    data.name ? truncateText(data.name) : ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET,
  Keys: (data) =>
    data.key.length > 0
      ? data.key.join(', ')
      : ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET,
  Description: (data) =>
    data.description
      ? truncateText(data.description)
      : ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET,
  Instruction: (data) =>
    data.instruction
      ? truncateText(data.instruction)
      : ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET,
  Models: (data) => {
    if (data.models.length === 0) return 'system (default)'
    if (data.models.length === 1) return data.models[0].model
    return data.models.length.toString()
  },
}

function formatFieldValue(fieldName, commandData) {
  const formatter = fieldFormatters[fieldName]
  return formatter ? formatter(commandData) : ''
}

function hasChanges(originalData, currentData) {
  return JSON.stringify(originalData) !== JSON.stringify(currentData)
}

function getChangedFields(originalData, currentData) {
  const fieldCheckers = {
    Name: (orig, curr) => orig.name !== curr.name,
    Keys: (orig, curr) => JSON.stringify(orig.key) !== JSON.stringify(curr.key),
    Description: (orig, curr) => orig.description !== curr.description,
    Instruction: (orig, curr) => orig.instruction !== curr.instruction,
    Models: (orig, curr) =>
      JSON.stringify(orig.models) !== JSON.stringify(curr.models),
  }

  return Object.entries(fieldCheckers)
    .filter(([fieldName, checker]) => checker(originalData, currentData))
    .map(([fieldName]) => fieldName)
}

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

async function editCollection(commandData, context, configKey) {
  const config = COLLECTION_CONFIGS[configKey]
  const items = commandData[config.fieldName]

  while (true) {
    const actions = generateCollectionActions(items)
    const displayTitle = `EDITING ${config.displayName} → ${commandData.name || 'Unnamed'} [${config.displayItems(items)}]`

    const selectedIndex = await createNavigationMenu(
      displayTitle,
      actions,
      0,
      context,
    )

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

async function handleCollectionAction(action, commandData, context, config) {
  const items = commandData[config.fieldName]

  if (action === COLLECTION_ACTIONS.ADD) {
    await config.addFlow(commandData, context)
  } else if (action === COLLECTION_ACTIONS.REMOVE) {
    await config.removeFlow(commandData, context)
  } else if (action === COLLECTION_ACTIONS.REMOVE_ALL) {
    commandData[config.fieldName] = []
    console.log(
      ANSI.COLORS.GREEN +
        `All ${config.displayName.toLowerCase()} removed` +
        ANSI.COLORS.RESET,
    )
  }
}

function generateMenuWithValues(
  commandData,
  fieldOptions,
  originalData = null,
) {
  const menuItems = []

  fieldOptions.forEach((field) => {
    if (field.name === 'Save & Exit' || field.name === 'Cancel') {
      return
    }

    const fieldValue = formatFieldValue(field.name, commandData)
    const padding = ' '.repeat(
      Math.max(0, APP_CONSTANTS.MENU_FIELD_NAME_WIDTH - field.name.length),
    )
    menuItems.push(`${field.name}${padding} : ${fieldValue}`)
  })

  menuItems.push('')

  if (originalData && hasChanges(originalData, commandData)) {
    const changedFields = getChangedFields(originalData, commandData)
    const changesText =
      changedFields.length === 1
        ? `${changedFields[0]} changed`
        : `${changedFields.join(', ')} changed`
    menuItems.push(`Save & Exit (${changesText})`)
  }
  menuItems.push('Back')

  return menuItems
}

// Field editing functions
async function editName(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Name ===' + ANSI.COLORS.RESET)
  console.log(
    `Current name: ${ANSI.COLORS.BLUE}${commandData.name || 'Not set'}${ANSI.COLORS.RESET}`,
  )

  const newName = await createTextInput(
    'Enter command name',
    commandData.name,
    context,
  )

  if (newName) {
    const trimmedName = newName.trim()
    if (trimmedName !== commandData.name) {
      commandData.name = trimmedName
      if (trimmedName) {
        console.log(
          ANSI.COLORS.GREEN + `Name set to: ${commandData.name}` + ANSI.COLORS.RESET,
        )
      } else {
        console.log(ANSI.COLORS.YELLOW + 'Name cleared' + ANSI.COLORS.RESET)
      }
    } else {
      console.log(
        ANSI.COLORS.YELLOW +
          `Name unchanged: ${commandData.name || 'empty'}` +
          ANSI.COLORS.RESET,
      )
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
    return 'Key cannot contain spaces'
  }

  const allowedChars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'
  for (const char of newKey) {
    if (!allowedChars.includes(char)) {
      return `Invalid character: ${char}`
    }
  }

  if (commandData.key.includes(newKey)) {
    return 'Key already exists in this command'
  }

  const allExistingKeys = getAllExistingKeys()
  if (allExistingKeys.includes(newKey)) {
    return 'Key already exists in system or other commands'
  }

  return null
}

async function addKeyWithValidation(commandData, context) {
  const newKey = await createTextInput('Enter new key', '', context)
  const keyValue = getCleanInput(newKey)

  if (!keyValue) {
    console.log(ANSI.COLORS.YELLOW + 'Key addition cancelled' + ANSI.COLORS.RESET)
    return
  }

  const validationError = validateKey(keyValue, commandData)

  if (validationError) {
    console.log(ANSI.COLORS.RED + `Invalid key: ${validationError}` + ANSI.COLORS.RESET)
    return
  }

  commandData.key.push(keyValue)
  console.log(ANSI.COLORS.GREEN + `Key "${keyValue}" added` + ANSI.COLORS.RESET)
}

async function removeKeysInteractive(commandData, context) {
  if (commandData.key.length === 0) {
    console.log(ANSI.COLORS.YELLOW + 'No keys to remove' + ANSI.COLORS.RESET)
    return
  }

  if (commandData.key.length === 1) {
    const result = await createNavigationMenu(
      `Remove key "${commandData.key[0]}"?`,
      ['Yes, remove it', 'No, keep it'],
      0,
      context,
    )

    if (result === 0) {
      const removedKey = commandData.key.pop()
      console.log(ANSI.COLORS.GREEN + `Key "${removedKey}" removed` + ANSI.COLORS.RESET)
    }
    return
  }

  const result = await createToggleMenu(
    'Confirm removal - keys marked with ☓ will be deleted:',
    commandData.key,
    commandData.key,
    ['Confirm', 'Back'],
  )

  if (result.action === 'confirm') {
    const keysToRemove = result.removedItems
    if (keysToRemove.length > 0) {
      commandData.key = commandData.key.filter(
        (key) => !keysToRemove.includes(key),
      )
      console.log(
        ANSI.COLORS.GREEN +
          `Removed ${keysToRemove.length} keys: ${keysToRemove.join(', ')}` +
          ANSI.COLORS.RESET,
      )
    } else {
      console.log(ANSI.COLORS.YELLOW + 'No keys marked for removal' + ANSI.COLORS.RESET)
    }
  }
}

async function addModelProviderFlow(commandData, context) {
  const availableProviders = context.providers
    ? context.providers.getAvailable()
    : []

  if (availableProviders.length === 0) {
    console.log(ANSI.COLORS.YELLOW + 'No providers available' + ANSI.COLORS.RESET)
    return
  }

  const providerNames = availableProviders.map((p) => p.name)
  const providerIndex = await createNavigationMenu(
    'Select provider:',
    providerNames,
    0,
    context,
  )

  if (providerIndex === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Model addition cancelled' + ANSI.COLORS.RESET)
    return
  }

  const selectedProvider = availableProviders[providerIndex]

  const originalProvider = context.providers.getCurrent()
  let providerModels = []

  try {
    await context.providers.switch(selectedProvider.key)
    providerModels = context.models.getAvailable()

    if (providerModels.length === 0) {
      console.log(
        ANSI.COLORS.YELLOW +
          `No models available for ${selectedProvider.name}` +
          ANSI.COLORS.RESET,
      )
      return
    }
  } finally {
    if (originalProvider && originalProvider.key !== selectedProvider.key) {
      await context.providers.switch(originalProvider.key)
    }
  }

  const modelNames = providerModels.map((model) => {
    return typeof model === 'string'
      ? model
      : model.id || model.name || String(model)
  })

  const modelIndex = await createNavigationMenu(
    `Select model from ${selectedProvider.name}:`,
    modelNames,
    0,
    context,
  )

  if (modelIndex === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Model addition cancelled' + ANSI.COLORS.RESET)
    return
  }

  const selectedModelId = modelNames[modelIndex]
  const modelEntry = {
    provider: selectedProvider.key,
    model: selectedModelId,
  }

  const existsIndex = commandData.models.findIndex((m) => {
    return (
      typeof m === 'object' &&
      m.provider === modelEntry.provider &&
      m.model === modelEntry.model
    )
  })

  if (existsIndex !== -1) {
    console.log(
      ANSI.COLORS.YELLOW +
        `Model "${modelEntry.model}" from ${selectedProvider.name} already exists` +
        ANSI.COLORS.RESET,
    )
    return
  }

  commandData.models.push(modelEntry)
  console.log(
    ANSI.COLORS.GREEN +
      `Added model "${modelEntry.model}" from ${selectedProvider.name}` +
      ANSI.COLORS.RESET,
  )
}

async function removeModelsToggle(commandData, context) {
  if (commandData.models.length === 0) {
    console.log(ANSI.COLORS.YELLOW + 'No models to remove' + ANSI.COLORS.RESET)
    return
  }

  const modelDisplayNames = commandData.models.map((model) => {
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
      context,
    )

    if (result === 0) {
      const removedModel = commandData.models.pop()
      const displayName =
        typeof removedModel === 'string'
          ? removedModel
          : `${removedModel.model} (${removedModel.provider})`
      console.log(ANSI.COLORS.GREEN + `Model "${displayName}" removed` + ANSI.COLORS.RESET)
    }
    return
  }

  const result = await createToggleMenu(
    'Confirm removal - models marked with ☓ will be deleted:',
    modelDisplayNames,
    modelDisplayNames,
    ['Confirm', 'Back'],
  )

  if (result.action === 'confirm') {
    const modelsToRemove = result.removedItems
    if (modelsToRemove.length > 0) {
      const originalLength = commandData.models.length
      commandData.models = commandData.models.filter((model, index) => {
        return !modelsToRemove.includes(modelDisplayNames[index])
      })
      const removedCount = originalLength - commandData.models.length
      console.log(
        ANSI.COLORS.GREEN +
          `Removed ${removedCount} models: ${modelsToRemove.join(', ')}` +
          ANSI.COLORS.RESET,
      )
    } else {
      console.log(ANSI.COLORS.YELLOW + 'No models marked for removal' + ANSI.COLORS.RESET)
    }
  }
}

async function editDescription(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Description ===' + ANSI.COLORS.RESET)
  console.log(`Current description: ${commandData.description || 'Not set'}`)

  const newDesc = await createTextInput(
    'Enter description',
    commandData.description,
    context,
  )

  if (newDesc) {
    const trimmedDesc = newDesc.trim()
    if (trimmedDesc !== commandData.description) {
      commandData.description = trimmedDesc
      if (trimmedDesc) {
        console.log(
          ANSI.COLORS.GREEN + `Description set to: ${trimmedDesc}` + ANSI.COLORS.RESET,
        )
      } else {
        console.log(ANSI.COLORS.YELLOW + 'Description cleared' + ANSI.COLORS.RESET)
      }
    } else {
      console.log(
        ANSI.COLORS.YELLOW +
          `Description unchanged: ${commandData.description || 'empty'}` +
          ANSI.COLORS.RESET,
      )
    }
  }
}

async function editInstruction(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Instruction ===' + ANSI.COLORS.RESET)
  const displayInst = commandData.instruction
    ? commandData.instruction.length > 100
      ? commandData.instruction.substring(0, 100) + '...'
      : commandData.instruction
    : 'Not set'
  console.log(`Current instruction: ${displayInst}`)

  const newInst = await createTextInput(
    'Enter instruction',
    commandData.instruction,
    context,
  )

  if (newInst) {
    const trimmedInst = newInst.trim()
    if (trimmedInst !== commandData.instruction) {
      commandData.instruction = trimmedInst
      if (trimmedInst) {
        console.log(ANSI.COLORS.GREEN + `Instruction set` + ANSI.COLORS.RESET)
      } else {
        console.log(ANSI.COLORS.YELLOW + 'Instruction cleared' + ANSI.COLORS.RESET)
      }
    } else {
      console.log(ANSI.COLORS.YELLOW + `Instruction unchanged` + ANSI.COLORS.RESET)
    }
  }
}

async function editModels(commandData, context) {
  await editCollection(commandData, context, 'models')
}

async function handleListCommands(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(
        ANSI.COLORS.YELLOW + 'No commands found in database.' + ANSI.COLORS.RESET + '\n',
      )
      return
    }

    console.log(ANSI.COLORS.CYAN + '\n=== Available Commands ===' + ANSI.COLORS.RESET)

    for (const [id, cmd] of commandEntries) {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      const commandName = cmd.name || 'Unnamed Command'

      // Format created date
      const createdDate = new Date(cmd.created_at * 1000).toLocaleDateString(
        'en-US',
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        },
      )

      console.log(
        `${ANSI.COLORS.BLUE}${commandName}${ANSI.COLORS.RESET} [${ANSI.COLORS.YELLOW}${keyText}${ANSI.COLORS.RESET}]`,
      )
      console.log(`  ${cmd.description}`)
      console.log(`  ${ANSI.COLORS.GREY}Created: ${createdDate}${ANSI.COLORS.RESET}`)

      // Show Updated only if command was actually updated AND date is different
      if (cmd.updated_at) {
        const updatedDate = new Date(cmd.updated_at * 1000).toLocaleDateString(
          'en-US',
          {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          },
        )

        if (updatedDate !== createdDate) {
          console.log(`  ${ANSI.COLORS.GREY}Updated: ${updatedDate}${ANSI.COLORS.RESET}`)
        }
      }
      console.log('')
    }

    console.log(ANSI.COLORS.GREY + '\nPress Enter to continue...' + ANSI.COLORS.RESET)
    await createTextInput('Press Enter to continue', '', context)
  } catch (error) {
    console.log(
      outputHandler.formatError(`Error listing commands: ${error.message}`),
    )
  }
}

async function handleDeleteCommand(context) {
  try {
    const commands = databaseCommandService.getCommands()
    const commandEntries = Object.entries(commands)

    if (commandEntries.length === 0) {
      console.log(
        ANSI.COLORS.YELLOW + 'No commands available to delete.' + ANSI.COLORS.RESET + '\n',
      )
      return
    }

    const commandOptions = commandEntries.map(([id, cmd]) => {
      const keyText = Array.isArray(cmd.key) ? cmd.key.join(', ') : cmd.key
      return `${cmd.name} [${keyText}]`
    })

    console.log(ANSI.COLORS.RED + '\n=== Delete Command ===' + ANSI.COLORS.RESET)

    const selectedIndex = await createNavigationMenu(
      'Select command to delete:',
      commandOptions,
      0,
      context,
    )

    if (selectedIndex === -1) {
      console.log(ANSI.COLORS.YELLOW + 'Delete cancelled.' + ANSI.COLORS.RESET + '\n')
      return
    }

    const [commandId, command] = commandEntries[selectedIndex]

    console.log(
      ANSI.COLORS.RED +
        `\nAre you sure you want to delete "${command.name}"?` +
        ANSI.COLORS.RESET,
    )
    const confirmation = await createNavigationMenu(
      'Confirm deletion:',
      ['Yes, delete it', 'No, cancel'],
      1,
      context,
    )

    if (confirmation === -1 || confirmation === 1) {
      console.log(ANSI.COLORS.YELLOW + 'Delete cancelled.' + ANSI.COLORS.RESET + '\n')
      return
    }

    const spinner = createSpinner('Deleting command...')
    spinner.start()

    databaseCommandService.deleteCommand(commandId)

    spinner.stop('success')
    console.log(
      outputHandler.formatSuccess(
        `✓ Command "${command.name}" deleted successfully!`,
      ),
    )
  } catch (error) {
    throw error
  }
}

function isCommandValid(commandData) {
  return (
    commandData.name &&
    commandData.key.length > 0 &&
    commandData.description &&
    commandData.instruction
  )
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

  const parts = cleanName.split('_').filter((part) => part.length > 0)
  const baseId = parts.join('_')

  const timestamp = Date.now().toString().slice(-6)
  return `${baseId}_${timestamp}`
}
