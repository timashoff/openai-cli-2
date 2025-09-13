import { createBaseError } from '../core/error-system/index.js'

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