// Serialize commands to a human-friendly TOML document with a fixed schema.
// JSON.stringify is used only as a safe double-quoted-string escaper (no regex).

const quote = (value) => JSON.stringify(String(value))

const HEADER = `# openai-cli commands - edit this file, save, and the app reloads on your next prompt.
#
# Each [commands.<id>] block is one command:
#   key         = aliases you type (English and/or Russian), e.g. ["rr"] or ["сс", "cc"]
#   description = short human note (any language)
#   models      = optional; omit to use the current provider/model. Multiple models = compare side by side.
#   instruction = the prompt prepended to your input. Use ''' ... ''' for multi-line.
#   context     = optional; set true to carry chat history into this command (default false = stateless).
`

const keyLine = (keys) => `key = [${keys.map(quote).join(', ')}]`

const modelsLine = (models) => {
  if (!models || models.length === 0) return null
  const inline = models.map(
    (m) => `{ provider = ${quote(m.provider)}, model = ${quote(m.model)} }`,
  )
  if (models.length === 1) return `models = [${inline[0]}]`
  return 'models = [\n' + inline.map((line) => `  ${line},`).join('\n') + '\n]'
}

const instructionLine = (instruction) => {
  if (instruction.includes('\n')) {
    return "instruction = '''\n" + instruction + "\n'''"
  }
  return `instruction = ${quote(instruction)}`
}

const commandBlock = (id, command) => {
  const lines = [
    `[commands.${id}]`,
    keyLine(command.key),
    `description = ${quote(command.description)}`,
  ]
  const models = modelsLine(command.models)
  if (models) lines.push(models)
  if (command.context) lines.push('context = true')
  lines.push(instructionLine(command.instruction))
  return lines.join('\n')
}

export const serializeCommands = (commands) => {
  const blocks = Object.entries(commands).map(([id, command]) =>
    commandBlock(id, command),
  )
  return HEADER + '\n' + blocks.join('\n\n') + '\n'
}
