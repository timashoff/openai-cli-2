const createMenuTitle = (action, itemType, count, verb = '') => {
  const verbText = verb ? ` ${verb}` : ''
  return `${action} ${itemType}${verbText} (${count} available):`
}

export const createSelectionTitle = (itemType, count, verb = '') => {
  return createMenuTitle('Select', itemType, count, verb)
}