import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { getStateManager, resetStateManager } from '../core/StateManager.js'
import { PROVIDERS } from '../config/providers.js'

class MockResponseStream extends EventEmitter {
  constructor() {
    super()
    this._finalPromise = new Promise((resolve, reject) => {
      this._resolveFinal = resolve
      this._rejectFinal = reject
    })
    this.aborted = false
  }

  emitDelta(delta, snapshot = delta) {
    this.emit('response.output_text.delta', {
      delta,
      snapshot,
    })
  }

  emitCompleted(response) {
    this.emit('response.completed', { response })
    this._resolveFinal(response)
    this.emit('end')
  }

  emitError(error) {
    this.emit('error', error)
    this._rejectFinal(error)
  }

  finalResponse() {
    return this._finalPromise
  }

  abort() {
    this.aborted = true
    this.emit('abort', new Error('aborted'))
  }
}

test('createResponseStream aggregates deltas and resolves final output', async () => {
  process.env.OPENAI_API_KEY = 'test-key'
  resetStateManager()
  const stateManager = getStateManager()

  const mockStream = new MockResponseStream()
  const mockProvider = {
    async createResponseStream() {
      return mockStream
    },
  }

  stateManager.setProvider('openai', {
    instance: mockProvider,
    config: PROVIDERS.openai,
    models: [],
  })

  const controller = new AbortController()
  const profile = {
    id: 'TEST',
    provider: 'openai',
    model: 'gpt-5-mini',
    instructions: 'Reply cheerfully',
    tools: [],
    metadata: {},
  }

  const responseStream = await stateManager.createResponseStream({
    profile,
    userInput: 'Ping',
    signal: controller.signal,
  })

  const deltas = []
  responseStream.on('delta', ({ delta }) => {
    deltas.push(delta)
  })

  const completionPromise = responseStream.waitForCompletion()

  mockStream.emitDelta('Hello', 'Hello')
  mockStream.emitCompleted({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Hello world',
            annotations: [],
          },
        ],
      },
    ],
  })

  const result = await completionPromise

  assert.deepEqual(deltas, ['Hello'])
  assert.equal(result.text, 'Hello world')
  assert.equal(result.aborted, false)

  delete process.env.OPENAI_API_KEY
  resetStateManager()
})
