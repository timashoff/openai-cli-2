export function updateContext(stateManager, userInput, response) {
  // Normalize input: array -> joined string, string -> as-is
  const normalizedResponse = Array.isArray(response)
    ? response.join('\n\n')
    : response

  if (normalizedResponse.trim()) {
    stateManager.addToContext('user', userInput)
    stateManager.addToContext('assistant', normalizedResponse)
  }
}
