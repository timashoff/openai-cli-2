import { createBaseError } from '../core/error-system/index.js'

// Simple state management - no classes needed
const subscriptions = new Map()
let subscriptionCounter = 0

const validateEventName = (eventName) => {
  if (!eventName || typeof eventName !== 'string' || eventName.trim() === '') {
    throw createBaseError('Event name must be a non-empty string', true, 400)
  }
}

const validateHandler = (handler) => {
  if (typeof handler !== 'function') {
    throw createBaseError('Event handler must be a function', true, 400)
  }
}

const on = (eventName, handler) => {
  validateEventName(eventName)
  validateHandler(handler)
  
  if (!subscriptions.has(eventName)) {
    subscriptions.set(eventName, [])
  }
  
  const subscription = {
    id: `sub_${++subscriptionCounter}_${eventName}`,
    eventName,
    handler
  }
  
  subscriptions.get(eventName).push(subscription)
  return subscription.id
}

const off = (subscriptionId) => {
  for (const [eventName, subscribers] of subscriptions) {
    const index = subscribers.findIndex(sub => sub.id === subscriptionId)
    if (index !== -1) {
      subscribers.splice(index, 1)
      
      // Clean up empty event arrays
      if (subscribers.length === 0) {
        subscriptions.delete(eventName)
      }
      
      return true
    }
  }
  return false
}

const emit = async (eventName, data = null, options = {}) => {
  validateEventName(eventName)
  
  const payload = {
    type: eventName,
    data,
    timestamp: new Date(),
    source: options.source || 'unknown',
    metadata: options.metadata || {}
  }
  
  const subscribers = subscriptions.get(eventName)
  if (!subscribers || subscribers.length === 0) {
    return payload
  }
  
  // Execute all handlers
  const handlerPromises = subscribers.map(subscription => {
    try {
      return subscription.handler(payload)
    } catch (error) {
      console.error(`Error executing handler for event '${eventName}':`, error.message)
      return Promise.resolve()
    }
  })
  
  await Promise.all(handlerPromises)
  return payload
}

const emitSync = (eventName, data = null, options = {}) => {
  emit(eventName, data, options).catch(error => {
    console.error(`Error in async event '${eventName}':`, error.message)
  })
}

export const globalEventBus = { on, emit, emitSync, off }