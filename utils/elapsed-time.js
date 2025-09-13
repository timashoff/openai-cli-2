export const getElapsedTime = (startTime) => {
  if (!startTime) return 'N/A'
  return ((Date.now() - startTime) / 1000).toFixed(1)
}