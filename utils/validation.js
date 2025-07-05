import { AppError } from './error-handler.js'

/**
 * Валидирует строку на пустоту и тип
 * @param {any} value - значение для проверки
 * @param {string} fieldName - название поля для ошибки
 * @param {boolean} required - обязательно ли поле
 * @returns {string|null} валидированная строка или null
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
 * Валидирует число
 * @param {any} value - значение для проверки
 * @param {string} fieldName - название поля для ошибки
 * @param {object} options - опции валидации
 * @returns {number} валидированное число
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
 * Валидирует массив
 * @param {any} value - значение для проверки
 * @param {string} fieldName - название поля для ошибки
 * @param {object} options - опции валидации
 * @returns {Array} валидированный массив
 */
export function validateArray(value, fieldName = 'field', options = {}) {
  const { minLength = 0, maxLength = Number.MAX_SAFE_INTEGER, required = true } = options

  if (value === null || value === undefined) {
    if (required) {
      throw new AppError(`${fieldName} is required`, true, 400)
    }
    return null
  }

  if (!Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an array`, true, 400)
  }

  if (value.length < minLength) {
    throw new AppError(`${fieldName} must have at least ${minLength} items`, true, 400)
  }

  if (value.length > maxLength) {
    throw new AppError(`${fieldName} must have at most ${maxLength} items`, true, 400)
  }

  return value
}

/**
 * Валидирует объект
 * @param {any} value - значение для проверки
 * @param {string} fieldName - название поля для ошибки
 * @param {boolean} required - обязательно ли поле
 * @returns {object|null} валидированный объект
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
 * Валидирует выбор из списка возможных значений
 * @param {any} value - значение для проверки
 * @param {Array} allowedValues - массив допустимых значений
 * @param {string} fieldName - название поля для ошибки
 * @param {boolean} required - обязательно ли поле
 * @returns {any} валидированное значение
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
 * Валидирует email адрес
 * @param {string} email - email для проверки
 * @param {boolean} required - обязательно ли поле
 * @returns {string|null} валидированный email
 */
export function validateEmail(email, required = true) {
  const validatedString = validateString(email, 'email', required)
  
  if (!validatedString) {
    return null
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(validatedString)) {
    throw new AppError('Invalid email format', true, 400)
  }

  return validatedString
}

/**
 * Очищает строку от потенциально опасных символов
 * @param {string} input - входная строка
 * @returns {string} очищенная строка
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') {
    return ''
  }

  // Удаляем потенциально опасные символы и управляющие последовательности
  return input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Управляющие символы
    .replace(/[<>]/g, '') // HTML теги
    .trim()
}

/**
 * Проверяет размер данных
 * @param {any} data - данные для проверки
 * @param {number} maxSizeBytes - максимальный размер в байтах
 * @param {string} fieldName - название поля
 * @returns {boolean} true если размер допустимый
 */
export function validateDataSize(data, maxSizeBytes, fieldName = 'data') {
  const size = JSON.stringify(data).length
  
  if (size > maxSizeBytes) {
    throw new AppError(
      `${fieldName} size (${size} bytes) exceeds maximum allowed size (${maxSizeBytes} bytes)`,
      true,
      400
    )
  }

  return true
}

/**
 * Валидирует параметры функции по схеме
 * @param {object} params - параметры для валидации
 * @param {object} schema - схема валидации
 * @returns {object} валидированные параметры
 */
export function validateParams(params, schema) {
  const validated = {}

  for (const [key, validator] of Object.entries(schema)) {
    try {
      validated[key] = validator(params[key])
    } catch (error) {
      throw new AppError(`Parameter ${key}: ${error.message}`, true, 400)
    }
  }

  return validated
}
