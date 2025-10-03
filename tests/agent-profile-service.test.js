import test from 'node:test'
import assert from 'node:assert/strict'

import { agentProfileService } from '../services/agent-profile-service.js'

function createTestProfile(idSuffix) {
  return {
    id: `TEST_PROFILE_${idSuffix}`,
    name: `Test Profile ${idSuffix}`,
    description: 'Temporary profile for automated test',
    provider: 'openai',
    model: 'gpt-5-mini',
    instructions: 'Respond with a short confirmation.',
    tools: [],
    metadata: { purpose: 'test' },
  }
}

test('AgentProfileService should create, read, update, and delete profiles', async () => {
  const uniqueId = Date.now().toString()
  const profileData = createTestProfile(uniqueId)

  // Create
  const createdProfile = await agentProfileService.createProfile(profileData)
  assert.equal(createdProfile.id, profileData.id)
  assert.equal(createdProfile.model, profileData.model)

  // Read
  const loadedProfile = await agentProfileService.getProfile(profileData.id)
  assert(loadedProfile, 'Profile should be retrievable after creation')
  assert.equal(loadedProfile.instructions, profileData.instructions)

  // Update
  const updatedModel = 'gpt-5-nano'
  await agentProfileService.updateProfile(profileData.id, {
    ...loadedProfile,
    model: updatedModel,
  })

  const updatedProfile = await agentProfileService.getProfile(profileData.id)
  assert.equal(updatedProfile.model, updatedModel)

  // Delete
  const deletionResult = await agentProfileService.deleteProfile(profileData.id)
  assert.equal(deletionResult, true)
  const afterDelete = await agentProfileService.getProfile(profileData.id)
  assert.equal(afterDelete, null)
})
