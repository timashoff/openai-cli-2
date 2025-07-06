import { AppError } from './error-handler.js'

/**
 * Validates string for emptiness and type
 * @param {any} value - value to check
 * @param {string} fieldName - field name for error
 * @param {boolean} required - whether field is required
 * @returns {string|null} validated string or null
 */
export function validateString(value, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw new AppError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, true, 400)
  }

  const trimmed = value.trim()
  if (required && trimmed === '') {
    throw new AppError(`${fieldName} cannot be empty`, true, 400)
  }

  return trimmed || null
}

/**
 * Validates number
 * @param {any} value - value to check
 * @param {string} fieldName - field name for error
 * @param {object} options - validation options
 * @returns {number} validated number
 */
export function validateNumber(value, fieldName = 'field', options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = true } = options

  if (value === null || value === undefined) {
    if (required) {
      throw new AppError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  const num = typeof value === 'string' ? parseFloat(value) : value

  if (typeof num !== 'number' || isNaN(num)) {
    throw new AppError(`${fieldName} must be a valid number`, true, 400)
  }

  if (num < min) {
    throw new AppError(`${fieldName} must be at least ${min}`, true, 400)
  }

  if (num > max) {
    throw new AppError(`${fieldName} must be at most ${max}`, true, 400)
  }

  return num
}


/**
 * Validates object
 * @param {any} value - value to check
 * @param {string} fieldName - field name for error
 * @param {boolean} required - whether field is required
 * @returns {object|null} validated object
 */
export function validateObject(value, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw new AppError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an object`, true, 400)
  }

  return value
}

/**
 * Validates choice from list of possible values
 * @param {any} value - value to check
 * @param {Array} allowedValues - array of allowed values
 * @param {string} fieldName - field name for error
 * @param {boolean} required - whether field is required
 * @returns {any} validated value
 */
export function validateChoice(value, allowedValues, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw new AppError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (!allowedValues.includes(value)) {
    throw new AppError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      true,
      400
    )
  }

  return value
}


/**
 * Cleans string from potentially dangerous characters
 * @param {string} input - input string
 * @returns {string} cleaned string
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') {
    return ''
  }

  // Remove potentially dangerous characters and control sequences
  return input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Control characters
    .replace(/[<>]/g, '') // HTML tags
    .trim()
}


