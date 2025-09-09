import { createBaseError } from '../core/error-system/index.js'

/**
 * Validates string for emptiness and type




 */
export function validateString(value, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw createBaseError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (typeof value !== 'string') {
    throw createBaseError(`${fieldName} must be a string`, true, 400)
  }

  const trimmed = value.trim()
  if (required && trimmed === '') {
    throw createBaseError(`${fieldName} cannot be empty`, true, 400)
  }

  return trimmed || null
}

/**
 * Validates number




 */
export function validateNumber(value, fieldName = 'field', options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, required = true } = options

  if (value === null || value === undefined) {
    if (required) {
      throw createBaseError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  const num = typeof value === 'string' ? parseFloat(value) : value

  if (typeof num !== 'number' || isNaN(num)) {
    throw createBaseError(`${fieldName} must be a valid number`, true, 400)
  }

  if (num < min) {
    throw createBaseError(`${fieldName} must be at least ${min}`, true, 400)
  }

  if (num > max) {
    throw createBaseError(`${fieldName} must be at most ${max}`, true, 400)
  }

  return num
}


/**
 * Validates object




 */
export function validateObject(value, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw createBaseError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createBaseError(`${fieldName} must be an object`, true, 400)
  }

  return value
}

/**
 * Validates choice from list of possible values





 */
export function validateChoice(value, allowedValues, fieldName = 'field', required = true) {
  if (value === null || value === undefined) {
    if (required) {
      throw createBaseError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (!allowedValues.includes(value)) {
    throw createBaseError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      true,
      400
    )
  }

  return value
}


/**
 * Cleans string from potentially dangerous characters


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


