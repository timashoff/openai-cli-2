// Shared HTTP helper for the gateway routes.

// Read a JSON body with a hard size cap. Returns null on overflow or invalid
// JSON (callers map that to INVALID_INPUT).
export const readJsonBody = async (req, maxBytes) => {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) return null
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    return null
  }
}
