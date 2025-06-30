import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../../config/instructions.js'
import { color } from '../../config/color.js'

export const execHelp = () => {
  console.log(`
${color.yellow}system:${color.reset}`)
  help(SYS_INSTRUCTIONS)
  console.log(`
${color.yellow}openai prompts:${color.reset}`)
  help(INSTRUCTIONS)

  console.log(
    `
${color.yellow}Usage:${color.reset}
user> ${color.cyan}gg${color.reset} i will arrive in airport at 8:00 pm`,
    '\nopenai> Corrected sentence: I will arrive at the airport at 8:00 PM\n',
  )
  console.log(
    `${color.yellow}Clipboard Integration:${color.reset}\nTo include text from your clipboard, add ${color.cyan}'$'${color.reset} to your prompt.`,
    `\nuser> ${color.cyan}code $${color.reset}\n`,
  )
}

//helpers
function help(obj) {
  const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b))
  const sortedObj = {}
  sortedKeys.forEach((key) => (sortedObj[key] = obj[key]))
  for (let prop in sortedObj) {
    const command =
      color.cyan + sortedObj[prop].key.sort().reverse().join('  ') + color.reset
    console.log(
      color.reset + prop.toLowerCase().padEnd(20, ' '),
      command.padEnd(32, ' '),
      sortedObj[prop].description,
    )
  }
}
