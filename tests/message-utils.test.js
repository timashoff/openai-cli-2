import test from 'node:test'
import assert from 'node:assert/strict'

import { prepareResponseInput } from '../utils/message-utils.js'

const SAMPLE_HISTORY = [
  { role: 'user', content: 'Hi there' },
  { role: 'assistant', content: 'Hello!' },
]

test('prepareResponseInput formats history for Responses API', () => {
  const result = prepareResponseInput(SAMPLE_HISTORY, 'How are you?')

  assert.deepEqual(result, [
    {
      role: 'user',
      content: [{ type: 'input_text', text: 'Hi there' }],
    },
    {
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello!' }],
    },
    {
      role: 'user',
      content: [{ type: 'input_text', text: 'How are you?' }],
    },
  ])
})

test('prepareResponseInput flattens array content', () => {
  const history = [
    { role: 'assistant', content: ['First line', 'Second line'] },
  ]

  const result = prepareResponseInput(history, 'Done')

  assert.equal(result[0].content[0].text, 'First line\nSecond line')
})
