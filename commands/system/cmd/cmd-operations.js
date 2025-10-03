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

const DEFAULT_COMMAND_TYPE = 'agent'
const DEFAULT_INPUT_MODE = 'text'

const COMMAND_TYPE_OPTIONS = [
  { label: 'Agent (Responses API)', value: 'agent' },
  { label: 'Legacy (Chat Completions)', value: 'legacy' },
]

const INPUT_MODE_HINTS = [
  'text',
  'editor',
  'clipboard',
]

function getCleanInput(input) {
  return input?.trim() || null
}

function getOptionLabel(option) {
  if (option && typeof option === 'object') {
    return option.label
  }
  return option
}

function flattenMetadataValue(value) {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function formatMetadataValue(input) {
  const trimmed = getCleanInput(input)
  if (trimmed === null) {
    return ''
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      return parsed
    } catch {
      return trimmed
    }
  }

  const lower = trimmed.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false

  const numeric = Number(trimmed)
  if (!Number.isNaN(numeric) && trimmed.trim() !== '') {
    return numeric
  }

  return trimmed
}

const COMMAND_FIELD_HINTS = {
  Name: () => 'Displayed in help output and command lists',
  Keys: () => 'Trigger aliases (space-separated) that activate the command',
  Description: () => 'Short description shown in help/menus',
  'Agent profile': (commandType) =>
    commandType === 'agent'
      ? 'Select or create the Responses profile used for this command'
      : null,
  'Command type': () => 'Choose between legacy chat-completions and Responses agent',
  'Input mode': () => 'Controls how the CLI gathers input (text/editor/clipboard)',
  Instruction: (commandType) =>
    commandType === 'agent'
      ? 'Hidden for agent commands (profile provides instructions)'
      : 'Prompt text sent to the model before user input',
  Models: (commandType) =>
    commandType === 'agent'
      ? 'Hidden for agent commands (profile controls the model)'
      : 'Optional per-command model overrides',
}

function getCommandFieldHint(fieldName, commandType) {
  const hintSource = COMMAND_FIELD_HINTS[fieldName]
  if (!hintSource) {
    return null
  }
  return typeof hintSource === 'function' ? hintSource(commandType) : hintSource
}

function getMainMenuHint(label) {
  switch (label) {
    case 'Add command':
      return 'Create a new CLI shortcut (legacy or agent)'
    case 'Edit command':
      return 'Modify an existing command'
    case 'List commands':
      return 'Show all configured commands'
    case 'Delete command':
      return 'Remove a command from the database'
    case 'Manage agent profiles':
      return 'Create or edit Responses API profiles'
    case 'Exit':
      return 'Return to the CLI prompt'
    default:
      return ''
  }
}

function getAgentMenuHint(label) {
  switch (label) {
    case 'Add agent profile':
      return 'Create a new Responses API profile'
    case 'Edit agent profile':
      return 'Modify an existing profile'
    case 'List agent profiles':
      return 'Show all profiles stored in SQLite'
    case 'Delete agent profile':
      return 'Remove a profile (ensure commands are unlinked)'
    case 'Back':
      return 'Return to the previous menu'
    default:
      return ''
  }
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
  { name: 'Manage agent profiles', action: handleManageAgentProfiles },
  { name: 'Exit', action: null },
]

async function resolveAgentProfileLabel(profileId, context) {
  if (!profileId) {
    return ''
  }

  const agentProfiles = getAgentProfilesContext(context)
  if (!agentProfiles) {
    return profileId
  }

  try {
    const profile = await agentProfiles.getProfile(profileId)
    if (!profile) {
      return profileId
    }
    return formatAgentProfileLabel(profile)
  } catch {
    return profileId
  }
}

async function ensureCommandProfileLabel(commandData, context) {
  if ((commandData.command_type || DEFAULT_COMMAND_TYPE) !== 'agent') {
    commandData.agent_profile_label = ''
    return
  }

  if (!commandData.agent_profile_id) {
    commandData.agent_profile_label = ''
    return
  }
  commandData.agent_profile_label = await resolveAgentProfileLabel(
    commandData.agent_profile_id,
    context,
  )
}

function formatAgentProfileLabel(profile) {
  if (!profile) {
    return ''
  }

  if (profile.name && profile.name !== profile.id) {
    return profile.name
  }

  return profile.id
}

const PROFILE_FIELD_HINTS = {
  Identifier: (mode) =>
    mode === 'create'
      ? 'Identifier must be unique — commands will look it up by ID.'
      : 'Identifier is read-only because commands already reference this profile.',
  Name: () => 'Name is shown in pickers and menus when selecting a profile.',
  Description: () => 'Description is optional text that helps distinguish profiles.',
  Provider: () => 'Provider determines which Responses API backend will run the agent.',
  Model: () => 'Model is the concrete model ID sent to the provider when streaming.',
  Instructions: () => 'Instructions act as the system prompt prepended to user requests.',
  'Advanced settings': () =>
    'Advanced settings hold Responses API extras: tool IDs and free-form metadata.',
}

const SYSTEM_METADATA_KEYS = new Set([
  'description',
  'commandKeys',
  'originalModel',
  'originalModels',
  'originalProvider',
])

function getProfileFieldHint(fieldName, mode) {
  const hintSource = PROFILE_FIELD_HINTS[fieldName]
  if (!hintSource) {
    return null
  }
  return typeof hintSource === 'function' ? hintSource(mode) : hintSource
}

async function promptCommandTypeSelection(currentType, context) {
  const menuOptions = COMMAND_TYPE_OPTIONS.map((option) => ({
    label: option.label,
    hint:
      option.value === 'agent'
        ? 'Stream via Responses API using an agent profile'
        : 'Legacy chat-completions style command',
  }))
  const currentIndex = Math.max(
    0,
    COMMAND_TYPE_OPTIONS.findIndex((option) => option.value === currentType),
  )

  const title = `SELECT COMMAND TYPE\n\n${ANSI.COLORS.GREY}Legacy commands send raw text via the old chat-completions workflow. Agent commands stream through the Responses API using an agent profile.${ANSI.COLORS.RESET}`

  const selection = await createNavigationMenu(title, menuOptions, currentIndex, context)

  if (selection === -1) {
    return null
  }

  return COMMAND_TYPE_OPTIONS[selection].value
}

function getCommandFieldOptions(commandData, context) {
  const options = [
    { name: 'Name', action: () => editName(commandData, context) },
    { name: 'Keys', action: () => editKeys(commandData, context) },
    {
      name: 'Description',
      action: () => editDescription(commandData, context),
    },
  ]

  if ((commandData.command_type || DEFAULT_COMMAND_TYPE) === 'agent') {
    options.push({ name: 'Agent profile', action: () => editAgentProfile(commandData, context) })
  }

  options.push(
    {
      name: 'Command type',
      action: () => editCommandType(commandData, context),
    },
    {
      name: 'Input mode',
      action: () => editInputMode(commandData, context),
    },
  )

  if ((commandData.command_type || DEFAULT_COMMAND_TYPE) !== 'agent') {
    options.push(
      {
        name: 'Instruction',
        action: () => editInstruction(commandData, context),
      },
      { name: 'Models', action: () => editModels(commandData, context) },
    )
  }

  return options
}

export const BaseCmdCommand = {
  async execute(args = [], context = {}) {
    let escHandlerId = null
    let escapeResolve = null
    let isCancelled = false
    let showMenuHint = true

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

      const menuOptions = mainMenuActions.map((item) => ({
        label: item.name,
        hint: getMainMenuHint(item.name),
      }))

      while (true && !isCancelled) {
        const escapePromise = new Promise((resolve) => {
          escapeResolve = resolve
        })

        const baseTitle = createSelectionTitle('action', mainMenuActions.length - 1)
        const title = showMenuHint
          ? `${baseTitle}\n\n${ANSI.COLORS.GREY}Hint: commands are CLI shortcuts (keys, descriptions). Agent profiles store model+instructions for the Responses API. Use "Manage agent profiles" to tweak behaviour, then link a profile to a command.${ANSI.COLORS.RESET}`
          : baseTitle

        const result = await Promise.race([
          createNavigationMenu(
            title,
            menuOptions,
            0,
            context,
          ),
          escapePromise,
        ])

        escapeResolve = null
        showMenuHint = false
        showMenuHint = false

        if (result === 'CANCELLED' || isCancelled) {
          return null
        }

        const selectedIndex = result

        if (selectedIndex === -1 || selectedIndex === mainMenuActions.length - 1) {
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
      command_type: DEFAULT_COMMAND_TYPE,
      agent_profile_id: '',
      input_mode: DEFAULT_INPUT_MODE,
      agent_profile_label: '',
    }

    const initialType = await promptCommandTypeSelection(commandData.command_type, context)
    if (initialType === null) {
      console.log(
        ANSI.COLORS.YELLOW + 'Command creation cancelled - type not selected.' + ANSI.COLORS.RESET,
      )
      return
    }
    commandData.command_type = initialType

    if (initialType === 'agent') {
      console.log(
        `${ANSI.COLORS.GREY}Agent command wizard: pick or create a profile now — инструкция и модель хранятся в профиле.${ANSI.COLORS.RESET}`,
      )
      const hasProfile = await selectAgentProfileForCommand(commandData, context)
      if (!hasProfile) {
        console.log(
          ANSI.COLORS.YELLOW +
            'Command creation cancelled - agent profile is required for agent commands.' +
            ANSI.COLORS.RESET +
            '\n',
        )
        return
      }
      await ensureCommandProfileLabel(commandData, context)
    }

    const success = await editCommandFields(commandData, context, 'create')

    if (success) {
      await ensureCommandProfileLabel(commandData, context)
      if (commandData.command_type === 'agent' && !commandData.agent_profile_id) {
        console.log(
          outputHandler.formatError(
            'Agent command requires an agent profile. Please create or select a profile first.',
          ),
        )
        const profileSelected = await selectAgentProfileForCommand(commandData, context)
        if (!profileSelected) {
          console.log(
            ANSI.COLORS.YELLOW +
              'Command creation cancelled - agent profile is mandatory.' +
              ANSI.COLORS.RESET +
              '\n',
          )
          return
        }
        await ensureCommandProfileLabel(commandData, context)
      }

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
      models: Array.isArray(existingCommand.models)
        ? [...existingCommand.models]
        : [],
      command_type: existingCommand.command_type || DEFAULT_COMMAND_TYPE,
      agent_profile_id: existingCommand.agent_profile_id || '',
      input_mode: existingCommand.input_mode || DEFAULT_INPUT_MODE,
      agent_profile_label: '',
    }

    await ensureCommandProfileLabel(commandData, context)

    const success = await editCommandFields(commandData, context, 'edit')

    if (success) {
      await ensureCommandProfileLabel(commandData, context)
      if (commandData.command_type === 'agent' && !commandData.agent_profile_id) {
        console.log(
          outputHandler.formatError('Agent commands must reference an agent profile.'),
        )
        const profileSelected = await selectAgentProfileForCommand(commandData, context)
        if (!profileSelected) {
          console.log(
            ANSI.COLORS.YELLOW +
              `Edit cancelled - command "${existingCommand.name}" requires an agent profile.` +
              ANSI.COLORS.RESET +
              '\n',
          )
          return
        }
        await ensureCommandProfileLabel(commandData, context)
      }

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
  while (true) {
    const fieldOptions = getCommandFieldOptions(commandData, context)
    const isAgentCommand = (commandData.command_type || DEFAULT_COMMAND_TYPE) === 'agent'

    const baseTitle = mode === 'create' ? 'CREATING COMMAND' : 'EDITING COMMAND'
    const hint = isAgentCommand
      ? `${ANSI.COLORS.GREY}Agent commands read their instructions from the linked profile. Use "Agent profile" to switch logic; legacy fields like Instruction/Models are hidden.${ANSI.COLORS.RESET}`
      : `${ANSI.COLORS.GREY}Legacy commands keep inline instructions and optional model overrides.${ANSI.COLORS.RESET}`
    const title = `${baseTitle}\n\n${hint}`

    const menuOptions = generateMenuWithValues(
      commandData,
      fieldOptions,
      originalData,
      [],
    )
    const initialIndex = Math.max(
      0,
      menuOptions.findIndex((item) => {
        const label =
          item && typeof item === 'object'
            ? item.label
            : item
        return label && label.startsWith('Agent profile')
      }),
    )

    const selectedIndex = await createNavigationMenu(
      title,
      menuOptions,
      initialIndex,
      context,
    )

    if (selectedIndex === -1 || selectedIndex === menuOptions.length - 1) {
      return false
    }

    if (getOptionLabel(menuOptions[selectedIndex]) === '') {
      continue
    }

    const selectedEntry = menuOptions[selectedIndex]
    const selectionLabel =
      selectedEntry && typeof selectedEntry === 'object'
        ? selectedEntry.label
        : selectedEntry

    if (selectionLabel.startsWith('Save & Exit')) {
      if (isCommandValid(commandData)) {
        return true
      } else {
        console.log(
          ANSI.COLORS.RED +
            `Please fill all required fields (${getValidationSummary(commandData)})` +
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
        if (selectedField.name === 'Agent profile') {
          await ensureCommandProfileLabel(commandData, context)
        }
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
  'Agent profile': (data) =>
    (data.command_type || DEFAULT_COMMAND_TYPE) === 'agent'
      ? data.agent_profile_id
        ? truncateText(data.agent_profile_label || data.agent_profile_id)
        : ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET
      : `${ANSI.COLORS.GREY}n/a${ANSI.COLORS.RESET}`,
  'Command type': (data) => data.command_type || DEFAULT_COMMAND_TYPE,
  'Input mode': (data) => data.input_mode || DEFAULT_INPUT_MODE,
  Instruction: (data) => {
    if (!data.instruction) {
      const commandType = data.command_type || DEFAULT_COMMAND_TYPE
      if (commandType === 'agent') {
        return `${ANSI.COLORS.GREY}n/a (agent)${ANSI.COLORS.RESET}`
      }

      return ANSI.COLORS.RED + 'null' + ANSI.COLORS.RESET
    }

    return truncateText(data.instruction)
  },
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
    'Agent profile': (orig, curr) =>
      orig.agent_profile_id !== curr.agent_profile_id,
    'Command type': (orig, curr) => orig.command_type !== curr.command_type,
    'Input mode': (orig, curr) => orig.input_mode !== curr.input_mode,
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
  extraActions = [],
) {
  const menuItems = []

  fieldOptions.forEach((field) => {
    if (field.name === 'Save & Exit' || field.name === 'Cancel') {
      return
    }

    const padding = ' '.repeat(
      Math.max(0, APP_CONSTANTS.MENU_FIELD_NAME_WIDTH - field.name.length),
    )
    const fieldValue = formatFieldValue(field.name, commandData)
    const displayLabel = `${field.name}${padding} : ${fieldValue}`
    menuItems.push({
      label: displayLabel,
      hint: getCommandFieldHint(field.name, commandData.command_type || DEFAULT_COMMAND_TYPE),
    })
  })

  menuItems.push('')

  if (extraActions && extraActions.length > 0) {
    for (const action of extraActions) {
        menuItems.push(action)
    }
    menuItems.push('')
  }

  if (originalData && hasChanges(originalData, commandData)) {
    const changedFields = getChangedFields(originalData, commandData)
    const changesText =
      changedFields.length === 1
        ? `${changedFields[0]} changed`
        : `${changedFields.join(', ')} changed`
    menuItems.push(`Save & Exit (${changesText})`)
  } else {
    menuItems.push('Save & Exit')
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

async function editAgentProfile(commandData, context) {
  const agentProfiles = getAgentProfilesContext(context)
  if (!agentProfiles) {
    return
  }

  while (true) {
    let profiles = await agentProfiles.getProfiles()

    if (!profiles || profiles.length === 0) {
      console.log(
        `${ANSI.COLORS.YELLOW}No agent profiles found. Creating a new one...${ANSI.COLORS.RESET}`,
      )
      await handleAddAgentProfile(agentProfiles, context)
      await agentProfiles.reloadProfiles()
      profiles = await agentProfiles.getProfiles()
      if (!profiles || profiles.length === 0) {
        console.log(ANSI.COLORS.YELLOW + 'Agent profile unchanged.' + ANSI.COLORS.RESET)
        return
      }
    }

    const formattedProfiles = profiles.map((profile) => {
      const label = formatAgentProfileLabel(profile)
      const description = profile.description || profile.metadata?.description
      return description ? `${label} — ${truncateText(description)}` : label
    })

    const commandType = commandData.command_type || DEFAULT_COMMAND_TYPE
    const allowClear = commandType !== 'agent'

    const profileOptions = formattedProfiles.map((item, index) => ({
      label: item,
      hint: `Link profile ${profiles[index].id} to this command`,
    }))

    const menuOptions = [...profileOptions, { label: 'Create new profile', hint: 'Open the profile editor' }]
    const createIndex = menuOptions.length - 1

    let clearIndex = -1
    if (allowClear) {
      menuOptions.push({ label: 'Clear profile', hint: 'Unlink the current profile' })
      clearIndex = menuOptions.length - 1
    }

    menuOptions.push({ label: 'Back', hint: 'Return without changes' })
    const backIndex = menuOptions.length - 1

    const currentIndex = commandData.agent_profile_id
      ? profiles.findIndex((profile) => profile.id === commandData.agent_profile_id)
      : -1

    const title = `Select an agent profile\n\n${ANSI.COLORS.GREY}Profiles define model + instructions for the Responses API. Pick an existing profile or create a new one.${ANSI.COLORS.RESET}`
    const selection = await createNavigationMenu(
      title,
      menuOptions,
      currentIndex >= 0 ? currentIndex : 0,
      context,
    )

    if (selection === -1 || selection === backIndex) {
      console.log(ANSI.COLORS.YELLOW + 'Agent profile unchanged.' + ANSI.COLORS.RESET)
      return
    }

    if (selection === clearIndex) {
      commandData.agent_profile_id = ''
      commandData.agent_profile_label = ''
      console.log(ANSI.COLORS.YELLOW + 'Agent profile cleared.' + ANSI.COLORS.RESET)
      return
    }

    if (selection === createIndex) {
      await handleAddAgentProfile(agentProfiles, context)
      await agentProfiles.reloadProfiles()
      continue
    }

    const selectedProfile = profiles[selection]
    if (selectedProfile.id === commandData.agent_profile_id) {
      console.log(ANSI.COLORS.YELLOW + 'Agent profile unchanged.' + ANSI.COLORS.RESET)
      return
    }
    commandData.agent_profile_id = selectedProfile.id
    commandData.agent_profile_label = formatAgentProfileLabel(selectedProfile)
    console.log(
      ANSI.COLORS.GREEN +
        `Agent profile set to: ${commandData.agent_profile_label}` +
        ANSI.COLORS.RESET,
    )
    return
  }
}

async function selectAgentProfileForCommand(commandData, context) {
  await editAgentProfile(commandData, context)
  return Boolean(commandData.agent_profile_id)
}

async function editCommandType(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Command Type ===' + ANSI.COLORS.RESET)
  console.log(`Current type: ${commandData.command_type || DEFAULT_COMMAND_TYPE}`)

  const presetOptions = COMMAND_TYPE_OPTIONS.map(
    (option) => `${option.label} [${option.value}]`,
  )
  const customOptionIndex = presetOptions.length

  const menuOptions = [...presetOptions, 'Enter custom value', 'Back']
  const currentIndex = Math.max(
    0,
    COMMAND_TYPE_OPTIONS.findIndex(
      (option) => option.value === (commandData.command_type || DEFAULT_COMMAND_TYPE),
    ),
  )

  const selectedIndex = await createNavigationMenu(
    'Select command type',
    menuOptions,
    currentIndex,
    context,
  )

  if (selectedIndex === -1 || selectedIndex === menuOptions.length - 1) {
    return
  }

  if (selectedIndex === customOptionIndex) {
    const newType = await createTextInput(
      'Enter command type value',
      commandData.command_type || DEFAULT_COMMAND_TYPE,
      context,
    )

    const trimmedType = getCleanInput(newType)
    if (!trimmedType) {
      console.log(ANSI.COLORS.YELLOW + 'Command type unchanged.' + ANSI.COLORS.RESET)
      return
    }

    updateCommandType(commandData, trimmedType)
    return
  }

  const selectedOption = COMMAND_TYPE_OPTIONS[selectedIndex]
  updateCommandType(commandData, selectedOption.value)
}

async function editInputMode(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Input Mode ===' + ANSI.COLORS.RESET)
  console.log(`Current mode: ${commandData.input_mode || DEFAULT_INPUT_MODE}`)
  if (INPUT_MODE_HINTS.length > 0) {
    console.log(
      `${ANSI.COLORS.GREY}Hints: ${INPUT_MODE_HINTS.join(', ')}${ANSI.COLORS.RESET}`,
    )
  }

  const presetModes = Array.from(
    new Set([
      ...INPUT_MODE_HINTS,
      commandData.input_mode || DEFAULT_INPUT_MODE,
    ].filter(Boolean)),
  )

  const presetIndex = Math.max(
    0,
    presetModes.findIndex((mode) => mode === commandData.input_mode),
  )

  const menuOptions = [...presetModes, 'Enter custom value', 'Back']
  const customIndex = menuOptions.length - 2
  const backIndex = menuOptions.length - 1

  const selectedIndex = await createNavigationMenu(
    'Select input mode',
    menuOptions,
    presetIndex,
    context,
  )

  if (selectedIndex === -1 || selectedIndex === backIndex) {
    return
  }

  if (selectedIndex === customIndex) {
    const newMode = await createTextInput(
      'Enter input mode value',
      commandData.input_mode || DEFAULT_INPUT_MODE,
      context,
    )

    const trimmedMode = getCleanInput(newMode)
    if (!trimmedMode) {
      console.log(ANSI.COLORS.YELLOW + 'Input mode unchanged.' + ANSI.COLORS.RESET)
      return
    }

    commandData.input_mode = trimmedMode
    console.log(
      ANSI.COLORS.GREEN +
        `Input mode set to: ${commandData.input_mode}` +
        ANSI.COLORS.RESET,
    )
    return
  }

  const selectedEntry = menuOptions[selectedIndex]
  const selectedMode = getOptionLabel(selectedEntry)
  if (selectedMode === commandData.input_mode) {
    console.log(ANSI.COLORS.YELLOW + 'Input mode unchanged.' + ANSI.COLORS.RESET)
    return
  }

  commandData.input_mode = selectedMode
  console.log(
    ANSI.COLORS.GREEN +
      `Input mode set to: ${commandData.input_mode}` +
      ANSI.COLORS.RESET,
  )
}

async function editInstruction(commandData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Instruction ===' + ANSI.COLORS.RESET)
  const displayInst = commandData.instruction
    ? commandData.instruction.length > 100
      ? commandData.instruction.substring(0, 100) + '...'
      : commandData.instruction
    : 'Not set'
  console.log(`Current instruction: ${displayInst}`)

  if ((commandData.command_type || DEFAULT_COMMAND_TYPE) === 'agent') {
    console.log(
      `${ANSI.COLORS.GREY}Note: agent commands use the linked profile instructions; this field is kept for legacy compatibility.${ANSI.COLORS.RESET}`,
    )
  }

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
      const commandType = cmd.command_type || DEFAULT_COMMAND_TYPE
      const inputMode = cmd.input_mode || DEFAULT_INPUT_MODE
      let agentProfileDisplay = 'n/a'
      if (commandType === 'agent') {
        const label = await resolveAgentProfileLabel(cmd.agent_profile_id, context)
        agentProfileDisplay = label || 'not set'
      }

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
      console.log(
        `  ${ANSI.COLORS.GREY}Type: ${commandType} | Input: ${inputMode} | Agent: ${agentProfileDisplay}${ANSI.COLORS.RESET}`,
      )
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

function getAgentProfilesContext(context) {
  if (!context.agentProfiles) {
    console.log(
      outputHandler.formatError('Agent profile management is unavailable in this context.'),
    )
    return null
  }
  const service = context.agentProfiles
  if (service && !service.getProfiles && typeof service.list === 'function') {
    service.getProfiles = service.list
  }
  return service
}

async function handleManageAgentProfiles(context) {
  const agentProfiles = getAgentProfilesContext(context)
  if (!agentProfiles) {
    return
  }

  let showHint = true

  const menuItems = [
    { label: 'Add agent profile', action: handleAddAgentProfile },
    { label: 'Edit agent profile', action: handleEditAgentProfile },
    { label: 'List agent profiles', action: handleListAgentProfiles },
    { label: 'Delete agent profile', action: handleDeleteAgentProfile },
    { label: 'Back', action: null },
  ]

  while (true) {
    const baseTitle = 'MANAGE AGENT PROFILES'
    const title = showHint
      ? `${baseTitle}\n\n${ANSI.COLORS.GREY}Profiles live in SQLite and control Responses API behaviour. Create or edit them here, затем привязывай к командам в разделе "Edit command".${ANSI.COLORS.RESET}`
      : baseTitle

    const selection = await createNavigationMenu(
      title,
      menuItems.map((item) => ({ label: item.label, hint: getAgentMenuHint(item.label) })),
      0,
      context,
    )

    if (selection === -1 || selection === menuItems.length - 1) {
      return
    }

    showHint = false

    const selected = menuItems[selection]
    if (selected && typeof selected.action === 'function') {
      try {
        await selected.action(agentProfiles, context)
      } catch (error) {
        console.log(
          outputHandler.formatError(`Profile operation failed: ${error.message}`),
        )
      }
    }
  }
}

function getResponseProviders(context) {
  try {
    const providerManager = context.providers
    if (!providerManager || typeof providerManager.getAvailable !== 'function') {
      return [{ key: 'openai', name: 'OpenAI' }]
    }

    const providers = providerManager.getAvailable()
    if (!Array.isArray(providers) || providers.length === 0) {
      return [{ key: 'openai', name: 'OpenAI' }]
    }

    const openaiProvider = providers.find((provider) => provider.key === 'openai')
    if (openaiProvider) {
      return [openaiProvider]
    }

    return [{ key: 'openai', name: 'OpenAI' }]
  } catch {
    return [{ key: 'openai', name: 'OpenAI' }]
  }
}

function createEmptyProfile() {
  return {
    id: '',
    name: '',
    description: '',
    provider: 'openai',
    model: '',
    instructions: '',
    tools: [],
    metadata: {},
    options: {
      enable_tool_selection: false,
    },
  }
}

async function handleAddAgentProfile(agentProfiles, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Add Agent Profile ===' + ANSI.COLORS.RESET)
  console.log(
    `${ANSI.COLORS.GREY}Note: Responses API profiles currently use the OpenAI provider by default.${ANSI.COLORS.RESET}`,
  )
  const profileData = createEmptyProfile()
  const success = await editAgentProfileFields(profileData, context, 'create')

  if (!success) {
    console.log(
      ANSI.COLORS.YELLOW +
        'Agent profile creation cancelled.' +
        ANSI.COLORS.RESET +
        '\n',
    )
    return
  }

  const spinner = createSpinner('Saving profile...')
  spinner.start()

  try {
    await agentProfiles.createProfile(profileData)
    await agentProfiles.reloadProfiles()
    spinner.stop('success')
    console.log(
      outputHandler.formatSuccess(
        `✓ Agent profile "${profileData.id}" created successfully!`,
      ),
    )
  } catch (error) {
    spinner.stop('error')
    throw error
  }
}

async function handleEditAgentProfile(agentProfiles, context) {
  const profiles = await agentProfiles.getProfiles()
  if (!profiles || profiles.length === 0) {
    console.log(
      ANSI.COLORS.YELLOW + 'No agent profiles available to edit.' + ANSI.COLORS.RESET + '\n',
    )
    return
  }

  const profileOptions = profiles.map((profile) => {
    const description = profile.description || profile.metadata?.description || 'No description'
    return `${profile.id} (${profile.model}) - ${description}`
  })

  const selection = await createNavigationMenu(
    'Select agent profile to edit',
    profileOptions,
    0,
    context,
  )

  if (selection === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Edit cancelled.' + ANSI.COLORS.RESET + '\n')
    return
  }

  const selectedProfile = profiles[selection]
  const editableProfile = {
    id: selectedProfile.id,
    name: selectedProfile.name || selectedProfile.id,
    description: selectedProfile.description || selectedProfile.metadata?.description || '',
    provider: selectedProfile.provider,
    model: selectedProfile.model,
    instructions: selectedProfile.instructions,
    tools: Array.isArray(selectedProfile.tools)
      ? [...selectedProfile.tools]
      : [],
    metadata: { ...(selectedProfile.metadata || {}) },
  }

  const success = await editAgentProfileFields(editableProfile, context, 'edit')
  if (!success) {
    console.log(
      ANSI.COLORS.YELLOW +
        `Agent profile "${selectedProfile.id}" unchanged.` +
        ANSI.COLORS.RESET +
        '\n',
    )
    return
  }

  const spinner = createSpinner('Updating profile...')
  spinner.start()

  try {
    await agentProfiles.updateProfile(selectedProfile.id, editableProfile)
    await agentProfiles.reloadProfiles()
    spinner.stop('success')
    console.log(
      outputHandler.formatSuccess(
        `✓ Agent profile "${selectedProfile.id}" updated successfully!`,
      ),
    )
  } catch (error) {
    spinner.stop('error')
    throw error
  }
}

async function handleListAgentProfiles(agentProfiles, context) {
  const profiles = await agentProfiles.getProfiles()
  if (!profiles || profiles.length === 0) {
    console.log(
      ANSI.COLORS.YELLOW + 'No agent profiles found.' + ANSI.COLORS.RESET + '\n',
    )
    return
  }

  console.log(ANSI.COLORS.CYAN + '\n=== Agent Profiles ===' + ANSI.COLORS.RESET)

  for (const profile of profiles) {
    const description = profile.description || profile.metadata?.description || 'No description provided'
    console.log(
      `${ANSI.COLORS.BLUE}${formatAgentProfileLabel(profile)}${ANSI.COLORS.RESET} (${profile.id})`,
    )
    console.log(`  Provider: ${profile.provider}`)
    console.log(`  Name: ${profile.name || profile.id}`)
    console.log(`  Description: ${description}`)
    if (Array.isArray(profile.tools) && profile.tools.length > 0) {
      console.log(`  Tools: ${profile.tools.map((tool) => (typeof tool === 'string' ? tool : tool.type || tool.name || 'custom')).join(', ')}`)
    }
    const metadataKeys = profile.metadata ? Object.keys(profile.metadata) : []
    if (metadataKeys.length > 0) {
      console.log(`  Metadata keys: ${metadataKeys.join(', ')}`)
    }
    console.log('')
  }

  console.log(ANSI.COLORS.GREY + '\nPress Enter to continue...' + ANSI.COLORS.RESET)
  await createTextInput('Press Enter to continue', '', context)
}

async function handleDeleteAgentProfile(agentProfiles, context) {
  const profiles = await agentProfiles.getProfiles()
  if (!profiles || profiles.length === 0) {
    console.log(
      ANSI.COLORS.YELLOW + 'No agent profiles available to delete.' + ANSI.COLORS.RESET + '\n',
    )
    return
  }

  const profileOptions = profiles.map((profile) => {
    const description = profile.description || profile.metadata?.description || 'No description'
    return `${profile.id} (${profile.model}) - ${description}`
  })

  const selection = await createNavigationMenu(
    'Select agent profile to delete',
    profileOptions,
    0,
    context,
  )

  if (selection === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Delete cancelled.' + ANSI.COLORS.RESET + '\n')
    return
  }

  const profile = profiles[selection]

  const confirmation = await createNavigationMenu(
    `Delete profile "${profile.id}"?`,
    ['Yes, delete', 'No, keep it'],
    1,
    context,
  )

  if (confirmation !== 0) {
    console.log(
      ANSI.COLORS.YELLOW +
        `Deletion cancelled. Profile "${profile.id}" kept.` +
        ANSI.COLORS.RESET +
        '\n',
    )
    return
  }

  const spinner = createSpinner('Deleting profile...')
  spinner.start()

  try {
    await agentProfiles.deleteProfile(profile.id)
    await agentProfiles.reloadProfiles()
    spinner.stop('success')
    console.log(
      outputHandler.formatSuccess(
        `✓ Agent profile "${profile.id}" deleted successfully!`,
      ),
    )
  } catch (error) {
    spinner.stop('error')
    throw error
  }
}

async function editAgentProfileFields(profileData, context, mode) {
  const originalData = JSON.parse(JSON.stringify(profileData))
  const fieldOptions = [
    {
      name: 'Identifier',
      action: mode === 'create' ? () => editProfileIdentifier(profileData, context) : null,
      readOnly: mode !== 'create',
    },
    { name: 'Name', action: () => editProfileName(profileData, context) },
    { name: 'Description', action: () => editProfileDescription(profileData, context) },
    { name: 'Provider', action: () => editProfileProvider(profileData, context) },
    { name: 'Model', action: () => editProfileModel(profileData, context) },
    { name: 'Instructions', action: () => editProfileInstructions(profileData, context) },
    { name: 'Advanced settings', action: () => editProfileAdvanced(profileData, context) },
  ]

  while (true) {
  const menuOptions = generateProfileMenuWithValues(profileData, fieldOptions, originalData, mode)
    const baseTitle = mode === 'create' ? 'CREATING AGENT PROFILE' : 'EDITING AGENT PROFILE'
    const selection = await createNavigationMenu(
      baseTitle,
      menuOptions,
      0,
      context,
    )

    if (selection === -1 || selection === menuOptions.length - 1) {
      return false
    }

    const selectedEntry = menuOptions[selection]
    const selectionLabel =
      selectedEntry && typeof selectedEntry === 'object'
        ? selectedEntry.label
        : selectedEntry

    if (!selectionLabel) {
      continue
    }

    if (typeof selectionLabel === 'string' && selectionLabel.startsWith('Save & Exit')) {
      if (isAgentProfileValid(profileData, mode)) {
        return true
      }
      console.log(
        ANSI.COLORS.RED +
          `Please fill required fields (${getProfileValidationSummary(mode)})` +
          ANSI.COLORS.RESET +
          '\n',
      )
      continue
    }

    const field = fieldOptions[selection]
    if (!field || typeof field.action !== 'function') {
      console.log(
        `${ANSI.COLORS.GREY}Field is read-only in this mode.${ANSI.COLORS.RESET}`,
      )
      continue
    }

    await field.action()
  }
}

function generateProfileMenuWithValues(profileData, fieldOptions, originalData, mode) {
  const menuItems = []

  fieldOptions.forEach((field) => {
    const baseLabel = field.readOnly ? `${field.name} [read-only]` : field.name
    const value = formatProfileFieldValue(field.name, profileData)
    const padding = Math.max(0, APP_CONSTANTS.MENU_FIELD_NAME_WIDTH - baseLabel.length)
    const label = `${baseLabel}${' '.repeat(padding)} : ${value}`
    menuItems.push({ label, hint: getProfileFieldHint(field.name, mode) })
  })

  menuItems.push('')

  if (mode === 'create' || hasProfileChanges(originalData, profileData)) {
    menuItems.push('Save & Exit')
  }

  menuItems.push('Back')
  return menuItems
}

function formatProfileFieldValue(fieldName, profileData) {
  switch (fieldName) {
    case 'Identifier':
      return profileData.id || `${ANSI.COLORS.RED}null${ANSI.COLORS.RESET}`
    case 'Name':
      return profileData.name || profileData.id || `${ANSI.COLORS.RED}null${ANSI.COLORS.RESET}`
    case 'Description':
      return truncateText(profileData.description || '—')
    case 'Provider':
      return profileData.provider || `${ANSI.COLORS.RED}null${ANSI.COLORS.RESET}`
    case 'Model':
      return profileData.model || `${ANSI.COLORS.RED}null${ANSI.COLORS.RESET}`
    case 'Instructions':
      return profileData.instructions
        ? truncateText(profileData.instructions.replace(/\s+/g, ' '))
        : `${ANSI.COLORS.RED}null${ANSI.COLORS.RESET}`
    case 'Advanced settings': {
      const toolCount = Array.isArray(profileData.tools) ? profileData.tools.length : 0
      const metadataKeys = Object.keys(profileData.metadata || {})
      const metadataLabel = metadataKeys.length === 1 ? 'key' : 'keys'
      return `Open... (Tools: ${toolCount}, Metadata ${metadataLabel}: ${metadataKeys.length})`
    }
    default:
      return ''
  }
}

function hasProfileChanges(originalData, currentData) {
  return JSON.stringify(originalData) !== JSON.stringify(currentData)
}

function getProfileValidationSummary(mode) {
  return mode === 'create'
    ? 'Identifier, Name, Provider, Model, Instructions'
    : 'Name, Provider, Model, Instructions'
}

function isAgentProfileValid(profileData, mode) {
  if (mode === 'create' && !profileData.id) {
    return false
  }

  return (
    Boolean(profileData.name || profileData.id) &&
    Boolean(profileData.provider) &&
    Boolean(profileData.model) &&
    Boolean(profileData.instructions)
  )
}

async function editProfileIdentifier(profileData, context) {
  const agentProfiles = context.agentProfiles
  const newId = await createTextInput('Enter profile ID', profileData.id, context)
  const trimmedId = getCleanInput(newId)

  if (!trimmedId) {
    console.log(ANSI.COLORS.YELLOW + 'Identifier unchanged.' + ANSI.COLORS.RESET)
    return
  }

  if (trimmedId === profileData.id) {
    console.log(ANSI.COLORS.YELLOW + 'Identifier unchanged.' + ANSI.COLORS.RESET)
    return
  }

  const exists = await agentProfiles.hasProfile(trimmedId)
  if (exists) {
    console.log(ANSI.COLORS.RED + `Profile "${trimmedId}" already exists.` + ANSI.COLORS.RESET)
    return
  }

  profileData.id = trimmedId
  if (!profileData.name) {
    profileData.name = trimmedId
  }
  console.log(
    ANSI.COLORS.GREEN + `Identifier set to: ${profileData.id}` + ANSI.COLORS.RESET,
  )
}

async function editProfileName(profileData, context) {
  const newName = await createTextInput('Enter profile name', profileData.name, context)
  const trimmed = getCleanInput(newName)
  if (trimmed === null) {
    console.log(ANSI.COLORS.YELLOW + 'Name unchanged.' + ANSI.COLORS.RESET)
    return
  }
  profileData.name = trimmed
  console.log(ANSI.COLORS.GREEN + `Name set to: ${trimmed}` + ANSI.COLORS.RESET)
}

async function editProfileDescription(profileData, context) {
  const newDesc = await createTextInput(
    'Enter profile description',
    profileData.description,
    context,
  )
  profileData.description = getCleanInput(newDesc) || ''
  console.log(ANSI.COLORS.GREEN + 'Description updated.' + ANSI.COLORS.RESET)
}

async function editProfileProvider(profileData, context) {
  const availableProviders = getResponseProviders(context)

  if (availableProviders.length === 0) {
    profileData.provider = 'openai'
    console.log(
      `${ANSI.COLORS.YELLOW}OpenAI provider not detected, falling back to default openai configuration.${ANSI.COLORS.RESET}`,
    )
    return
  }

  const providerLabels = availableProviders.map((provider) => provider.name)
  const currentIndex = Math.max(
    0,
    availableProviders.findIndex((provider) => provider.key === profileData.provider),
  )

  const title = `Select provider (Responses API)\n\n${ANSI.COLORS.GREY}Responses streaming now поддерживается только для OpenAI. Другие провайдеры будут сохранены в metadata как reference.${ANSI.COLORS.RESET}`
  const selection = await createNavigationMenu(
    title,
    providerLabels,
    currentIndex,
    context,
  )

  if (selection === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Provider unchanged.' + ANSI.COLORS.RESET)
    return
  }

  const selectedProvider = availableProviders[selection]

  if (selectedProvider.key !== 'openai') {
    console.log(
      `${ANSI.COLORS.YELLOW}Responses API currently supports only OpenAI. Provider will be set to openai.${ANSI.COLORS.RESET}`,
    )
  }

  profileData.provider = 'openai'
  console.log(
    ANSI.COLORS.GREEN + 'Provider set to: openai (Responses API)' + ANSI.COLORS.RESET,
  )
}

async function editProfileModel(profileData, context) {
  const providerManager = context.providers
  const modelManager = context.models
  const targetProvider = 'openai'

  if (!providerManager || !modelManager) {
    await promptForManualModel(profileData, context)
    return
  }

  let originalProvider = null
  try {
    originalProvider = providerManager.getCurrent()
  } catch (error) {
    // ignore
  }

  try {
    await providerManager.switch(targetProvider)
  } catch (error) {
    console.log(
      `${ANSI.COLORS.YELLOW}Failed to load OpenAI models automatically (${error.message}). Enter model manually.${ANSI.COLORS.RESET}`,
    )
    await promptForManualModel(profileData, context)
    return
  }

  let availableModels = []
  try {
    availableModels = modelManager.getAvailable()
  } catch (error) {
    console.log(
      `${ANSI.COLORS.YELLOW}Unable to list models automatically (${error.message}). Enter model manually.${ANSI.COLORS.RESET}`,
    )
    await promptForManualModel(profileData, context)
    return
  } finally {
    if (
      originalProvider &&
      originalProvider.key &&
      originalProvider.key !== targetProvider
    ) {
      try {
        await providerManager.switch(originalProvider.key)
      } catch {
        // ignore
      }
    }
  }

  if (!Array.isArray(availableModels) || availableModels.length === 0) {
    console.log(
      `${ANSI.COLORS.YELLOW}No models available from provider. Enter model manually.${ANSI.COLORS.RESET}`,
    )
    await promptForManualModel(profileData, context)
    return
  }

  const modelNames = availableModels.map((model) =>
    typeof model === 'string' ? model : model.id || model.name || model.model || String(model),
  )

  const initialIndex = Math.max(0, modelNames.findIndex((name) => name === profileData.model))
  const modelTitle = `Select OpenAI model\n\n${ANSI.COLORS.GREY}Responses API использует выбранную модель. Настройки инструмента и истории остаются в профиле.${ANSI.COLORS.RESET}`
  const selectedIndex = await createNavigationMenu(
    modelTitle,
    modelNames,
    initialIndex,
    context,
  )

  if (selectedIndex === -1) {
    console.log(ANSI.COLORS.YELLOW + 'Model unchanged.' + ANSI.COLORS.RESET)
    return
  }

  profileData.model = modelNames[selectedIndex]
  console.log(
    ANSI.COLORS.GREEN +
      `Model set to: ${profileData.model}` +
      ANSI.COLORS.RESET,
  )
}

async function promptForManualModel(profileData, context) {
  const fallback = profileData.model || 'gpt-5-mini'
  console.log(
    `${ANSI.COLORS.GREY}Specify the model identifier exactly as expected by the provider (e.g., "gpt-5-mini").${ANSI.COLORS.RESET}`,
  )
  const manualValue = await createTextInput('Enter model identifier', fallback, context)
  const trimmed = getCleanInput(manualValue)
  if (!trimmed) {
    console.log(ANSI.COLORS.YELLOW + 'Model unchanged.' + ANSI.COLORS.RESET)
    return
  }
  profileData.model = trimmed
  console.log(ANSI.COLORS.GREEN + `Model set to: ${trimmed}` + ANSI.COLORS.RESET)
}

async function editProfileInstructions(profileData, context) {
  console.log(ANSI.COLORS.CYAN + '\n=== Edit Instructions ===' + ANSI.COLORS.RESET)
  const preview = profileData.instructions
    ? truncateText(profileData.instructions.replace(/\s+/g, ' '))
    : 'Not set'
  console.log(`Current instructions: ${preview}`)

  const newInstructions = await createTextInput(
    'Enter instructions',
    profileData.instructions,
    context,
  )

  const trimmed = getCleanInput(newInstructions)
  if (!trimmed) {
    console.log(ANSI.COLORS.YELLOW + 'Instructions unchanged.' + ANSI.COLORS.RESET)
    return
  }

  profileData.instructions = trimmed
  console.log(ANSI.COLORS.GREEN + 'Instructions updated.' + ANSI.COLORS.RESET)
}

async function editProfileAdvanced(profileData, context) {
  while (true) {
    const toolCount = Array.isArray(profileData.tools) ? profileData.tools.length : 0
    const metadataKeys = Object.keys(profileData.metadata || {})

    const menuOptions = [
      {
        label: `Tools (${toolCount})`,
        hint: 'Manage Responses API tool IDs (e.g., code_interpreter, function names).',
      },
      {
        label:
          metadataKeys.length === 1
            ? 'Metadata (1 key)'
            : `Metadata (${metadataKeys.length} keys)`,
        hint: 'Free-form key/value metadata stored with this profile for routing.',
      },
      { label: 'Back', hint: 'Return to the profile fields.' },
    ]

    const title = `ADVANCED PROFILE SETTINGS\n\n${ANSI.COLORS.GREY}Tune Responses-specific extras here. Tools expose callable capabilities; metadata keeps lightweight tags for automation.${ANSI.COLORS.RESET}`
    const selection = await createNavigationMenu(
      title,
      menuOptions,
      0,
      context,
    )

    if (selection === -1 || selection === menuOptions.length - 1) {
      return
    }

    if (selection === 0) {
      await editProfileTools(profileData, context)
    } else if (selection === 1) {
      await editProfileMetadata(profileData, context)
    }
  }
}

async function editProfileTools(profileData, context) {
  while (true) {
    const actions = generateCollectionActions(profileData.tools)
    const title = `EDITING TOOLS → ${profileData.id || 'Draft'} [${profileData.tools.join(', ') || 'none'}]\n\n${ANSI.COLORS.GREY}Specify tool identifiers supported by the Responses API (e.g., "code_interpreter"). Leave empty if this agent does not call tools.${ANSI.COLORS.RESET}`
    const selection = await createNavigationMenu(
      title,
      actions,
      0,
      context,
    )

    if (selection === -1 || selection === actions.length - 1) {
      break
    }

    const action = actions[selection]
    if (!action) continue

    if (action === COLLECTION_ACTIONS.ADD) {
      const toolName = await createTextInput('Enter tool identifier', '', context)
      const trimmed = getCleanInput(toolName)
      if (!trimmed) {
        console.log(ANSI.COLORS.YELLOW + 'Tool addition cancelled.' + ANSI.COLORS.RESET)
        continue
      }
      profileData.tools.push(trimmed)
      console.log(ANSI.COLORS.GREEN + `Tool "${trimmed}" added.` + ANSI.COLORS.RESET)
    } else if (action === COLLECTION_ACTIONS.REMOVE) {
      if (profileData.tools.length === 0) {
        console.log(ANSI.COLORS.YELLOW + 'No tools to remove.' + ANSI.COLORS.RESET)
        continue
      }
      const toolIndex = await createNavigationMenu(
        'Select tool to remove',
        profileData.tools,
        0,
        context,
      )
      if (toolIndex === -1) {
        continue
      }
      const removed = profileData.tools.splice(toolIndex, 1)
      if (removed.length > 0) {
        console.log(ANSI.COLORS.GREEN + `Tool "${removed[0]}" removed.` + ANSI.COLORS.RESET)
      }
    } else if (action === COLLECTION_ACTIONS.REMOVE_ALL) {
      profileData.tools = []
      console.log(ANSI.COLORS.GREEN + 'All tools removed.' + ANSI.COLORS.RESET)
    }
  }
}

async function editProfileMetadata(profileData, context) {
  profileData.metadata = profileData.metadata || {}

  while (true) {
    const metadataEntries = Object.entries(profileData.metadata)
    const systemEntries = metadataEntries
      .filter(([key]) => SYSTEM_METADATA_KEYS.has(key))
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    const customEntries = metadataEntries
      .filter(([key]) => !SYSTEM_METADATA_KEYS.has(key))
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))

    const menuEntries = [
      ...systemEntries.map(([key, value]) => ({
        type: 'system',
        key,
        label: `[system] ${key}: ${flattenMetadataValue(value)}`,
        hint: 'Legacy value kept for compatibility; not editable here.',
      })),
      ...customEntries.map(([key, value]) => ({
        type: 'custom',
        key,
        label: `${key}: ${flattenMetadataValue(value)}`,
        hint: 'Edit or remove this metadata entry.',
      })),
      {
        type: 'add',
        label: 'Add metadata entry',
        hint: 'Create a custom key/value pair stored with this profile.',
      },
      {
        type: 'back',
        label: 'Back',
        hint: 'Return to advanced settings.',
      },
    ]

    const initialIndex = menuEntries.findIndex((entry) => entry.type === 'custom')
    const title = `EDITING METADATA → ${profileData.id || 'Draft'}\n\n${ANSI.COLORS.GREY}Custom metadata travels with the agent profile. Entries marked as [system] come from the migration and stay read-only.${ANSI.COLORS.RESET}`

    const selection = await createNavigationMenu(
      title,
      menuEntries.map(({ label, hint }) => ({ label, hint })),
      initialIndex === -1 ? Math.max(menuEntries.length - 2, 0) : initialIndex,
      context,
    )

    if (selection === -1) {
      break
    }

    const selectedEntry = menuEntries[selection]
    if (!selectedEntry) {
      continue
    }

    if (selectedEntry.type === 'back') {
      break
    }

    if (selectedEntry.type === 'system') {
      console.log(
        `${ANSI.COLORS.YELLOW}System metadata "${selectedEntry.key}" is locked for compatibility. Duplicate it under a new key if you need a custom copy.${ANSI.COLORS.RESET}`,
      )
      continue
    }

    if (selectedEntry.type === 'add') {
      const key = await createTextInput('Enter metadata key', '', context)
      const trimmedKey = getCleanInput(key)
      if (!trimmedKey) {
        console.log(ANSI.COLORS.YELLOW + 'Metadata key not set.' + ANSI.COLORS.RESET)
        continue
      }

      if (SYSTEM_METADATA_KEYS.has(trimmedKey)) {
        console.log(
          `${ANSI.COLORS.RED}Key "${trimmedKey}" is reserved for internal use. Choose a different name.${ANSI.COLORS.RESET}`,
        )
        continue
      }

      if (Object.prototype.hasOwnProperty.call(profileData.metadata, trimmedKey)) {
        console.log(
          `${ANSI.COLORS.RED}Metadata key "${trimmedKey}" already exists. Use a unique key.${ANSI.COLORS.RESET}`,
        )
        continue
      }

      const value = await createTextInput('Enter metadata value', '', context)
      profileData.metadata[trimmedKey] = formatMetadataValue(value)
      console.log(ANSI.COLORS.GREEN + `Metadata "${trimmedKey}" added.` + ANSI.COLORS.RESET)
      continue
    }

    if (selectedEntry.type === 'custom') {
      const { key } = selectedEntry
      const action = await createNavigationMenu(
        `Metadata "${key}"`,
        ['Edit value', 'Remove', 'Back'],
        0,
        context,
      )

      if (action === 0) {
        const newValue = await createTextInput('Enter new value', flattenMetadataValue(profileData.metadata[key]), context)
        profileData.metadata[key] = formatMetadataValue(newValue)
        console.log(ANSI.COLORS.GREEN + `Metadata "${key}" updated.` + ANSI.COLORS.RESET)
      } else if (action === 1) {
        delete profileData.metadata[key]
        console.log(ANSI.COLORS.GREEN + `Metadata "${key}" removed.` + ANSI.COLORS.RESET)
      }
    }
  }
}

function updateCommandType(commandData, newType) {
  const previousType = commandData.command_type || DEFAULT_COMMAND_TYPE

  if (previousType === newType) {
    console.log(ANSI.COLORS.YELLOW + 'Command type unchanged.' + ANSI.COLORS.RESET)
    return
  }

  commandData.command_type = newType
  console.log(
    ANSI.COLORS.GREEN +
      `Command type set to: ${commandData.command_type}` +
      ANSI.COLORS.RESET,
  )

  if (newType !== 'agent' && commandData.agent_profile_id) {
    commandData.agent_profile_id = ''
    commandData.agent_profile_label = ''
    console.log(
      `${ANSI.COLORS.GREY}Agent profile cleared because command is not agent-based.${ANSI.COLORS.RESET}`,
    )
  }

  if (newType === 'agent' && !commandData.agent_profile_id) {
    console.log(
      `${ANSI.COLORS.GREY}Tip: assign an agent profile before saving this command.${ANSI.COLORS.RESET}`,
    )
  }
}

function getValidationSummary(commandData) {
  const commandType = commandData.command_type || DEFAULT_COMMAND_TYPE
  if (commandType === 'agent') {
    return 'Name, Keys, Description, Agent profile'
  }

  return 'Name, Keys, Description, Instruction'
}

function isCommandValid(commandData) {
  const hasBaseFields =
    Boolean(commandData.name) &&
    commandData.key.length > 0 &&
    Boolean(commandData.description)

  if (!hasBaseFields) {
    return false
  }

  const commandType = commandData.command_type || DEFAULT_COMMAND_TYPE

  if (commandType === 'agent') {
    return Boolean(commandData.agent_profile_id)
  }

  return Boolean(commandData.instruction)
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
