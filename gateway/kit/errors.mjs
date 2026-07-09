// Zero-Trust error seam — the single place replies get their error shape.
// PUBLIC: predefined code + message pairs only. INTERNAL: raw errors go to
// the server log only, never into a reply, never with credentials attached.
// Catalog lifted from hsk-vocabulary backend/src/kit/http-errors.js; the
// sender is adapted from Fastify reply to a raw node:http response.

export const API_ERRORS = {
  INVALID_INPUT: {
    status: 400,
    code: 'INVALID_INPUT',
    message: 'Invalid input.',
  },
  INVALID_CREDENTIALS: {
    status: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'Incorrect email or password.',
  },
  UNAUTHORIZED: {
    status: 401,
    code: 'UNAUTHORIZED',
    message: 'Session expired. Please log in again.',
  },
  // The gateway's OWN session rejection on a proxied provider request. A distinct
  // code so the client can tell it apart from an upstream provider 401 (bad key/quota,
  // which the gateway passes through verbatim) and only suggest re-login for this one.
  GATEWAY_SESSION: {
    status: 401,
    code: 'GATEWAY_SESSION_INVALID',
    message: 'Gateway session expired or invalid.',
  },
  RATE_LIMITED: {
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Too many attempts. Please try again later.',
  },
  NOT_FOUND: {
    status: 404,
    code: 'NOT_FOUND',
    message: 'Not found.',
  },
  BAD_GATEWAY: {
    status: 502,
    code: 'BAD_GATEWAY',
    message: 'Upstream provider unreachable.',
  },
  SERVER_ERROR: {
    status: 500,
    code: 'SERVER_ERROR',
    message: 'Something went wrong. Please try again.',
  },
}

// Raw node:http error responder. Safe to call once per request; guards against
// a double-send if headers were already flushed (e.g. mid-stream failure).
export const sendApiError = (res, apiError) => {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(apiError.status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { code: apiError.code, message: apiError.message } }))
}
