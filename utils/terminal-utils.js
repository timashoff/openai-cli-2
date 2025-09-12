export const clearTerminalLine = () => {
  process.stdout.write('\r\x1b[K')
}