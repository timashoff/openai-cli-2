import { INSTRUCTIONS, SYS_INSTRUCTIONS } from '../../config/instructions.js'
import { color } from '../../config/color.js'

export const execHelp = () => {
  console.log(`\n${color.yellow}system:${color.reset}`)
  help(SYS_INSTRUCTIONS)
  console.log(`\n${color.yellow}openai prompts:${color.reset}`)
  help(INSTRUCTIONS)
  console.log('')
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
      sortedObj[prop].description
    )
  }
}
