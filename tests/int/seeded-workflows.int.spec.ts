import fs from 'fs'
import os from 'os'
import path from 'path'
import { Forbidden, getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

const workflowV1: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow',
  description: 'Version 1',
  triggers: [
    {
      type: 'collection-hook',
      parameters: { collectionSlug: 'posts', hook: 'afterChange' },
    },
  ],
  steps: [
    {
      name: 'Step One',
      type: 'noop-step',
      input: { message: 'v1' },
    },
  ],
}

const workflowV2: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow (Updated)',
  description: 'Version 2',
  triggers: [
    {
      type: 'collection-hook',
      parameters: { collectionSlug: 'posts', hook: 'afterDelete' },
    },
  ],
  steps: [
    {
      name: 'Step Two',
      type: 'noop-step',
      input: { message: 'v2' },
    },
  ],
}

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-test-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key` (default 'default') and
// destroy() does not clear that cache, so reusing the default key across
// tests silently hands back a previous, already-destroyed instance instead
// of initializing against the new config. Each call needs its own key.
const getTestPayload = (config: ReturnType<typeof buildTestConfig>) =>
  getPayload({ config, key: uniqueId() })

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

describe('seeded workflow reconciliation', () => {
  let dbFile: string
  let payload: Payload | undefined

  beforeEach(() => {
    dbFile = newDbFile()
  })

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
  })

  it('updates the existing slug and its related records when the seed definition changes on restart', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV1] }))

    const initial = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV1.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(initial.docs).toHaveLength(1)
    const firstVersion = initial.docs[0] as Record<string, any>
    const originalTriggerId = firstVersion.triggers[0]
    const originalStepId = firstVersion.steps[0].step

    await payload.destroy()
    payload = undefined

    // Restart against the same database with an updated definition under the same slug.
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV2] }))

    const afterReseed = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV2.slug } },
      depth: 0,
      overrideAccess: true,
    })
    // Reconciling must not create a second workflow for the same slug.
    expect(afterReseed.docs).toHaveLength(1)

    const updated = afterReseed.docs[0] as Record<string, any>
    expect(updated.id).toBe(firstVersion.id)
    expect(updated.name).toBe(workflowV2.name)
    expect(updated.description).toBe(workflowV2.description)
    expect(updated.readOnly).toBe(true)

    const newTriggerId = updated.triggers[0]
    const newStepId = updated.steps[0].step
    expect(newTriggerId).not.toBe(originalTriggerId)
    expect(newStepId).not.toBe(originalStepId)

    const newTrigger = await payload.findByID({
      collection: 'automation-triggers',
      id: newTriggerId,
      overrideAccess: true,
    })
    expect(newTrigger.hook).toBe('afterDelete')

    // The records the previous version referenced must be gone, not orphaned.
    await expect(
      payload.findByID({ collection: 'automation-triggers', id: originalTriggerId, overrideAccess: true })
    ).rejects.toThrow()
    await expect(
      payload.findByID({ collection: 'automation-steps', id: originalStepId, overrideAccess: true })
    ).rejects.toThrow()
  })

  it('preserves stale trigger/step records still referenced by an existing workflow run', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV1] }))

    const initial = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV1.slug } },
      depth: 0,
      overrideAccess: true,
    })
    const firstVersion = initial.docs[0] as Record<string, any>
    const originalTriggerId = firstVersion.triggers[0]
    const originalStepId = firstVersion.steps[0].step

    // Record a run that actually fired from the v1 trigger and executed the
    // v1 step, the way a real execution would. Reconciling the workflow to
    // v2 must not strand this run's references.
    await payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: firstVersion.id,
        firedTrigger: originalTriggerId,
        status: 'completed',
        startedAt: new Date().toISOString(),
        triggeredBy: 'test',
        stepResults: [
          { step: originalStepId, stepName: 'Step One', stepIndex: 0, status: 'succeeded' },
        ],
      },
      overrideAccess: true,
    })

    await payload.destroy()
    payload = undefined

    // Restart against the same database with an updated definition under the same slug.
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV2] }))

    const afterReseed = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV2.slug } },
      depth: 0,
      overrideAccess: true,
    })
    const updated = afterReseed.docs[0] as Record<string, any>
    // The workflow moves on to new triggers/steps exactly as in the
    // unreferenced case above...
    expect(updated.triggers[0]).not.toBe(originalTriggerId)
    expect(updated.steps[0].step).not.toBe(originalStepId)

    // ...but the historical run must still be able to resolve what it
    // actually fired from and executed, unlike the unreferenced case.
    const preservedTrigger = await payload.findByID({
      collection: 'automation-triggers',
      id: originalTriggerId,
      overrideAccess: true,
    })
    expect(preservedTrigger.id).toBe(originalTriggerId)

    const preservedStep = await payload.findByID({
      collection: 'automation-steps',
      id: originalStepId,
      overrideAccess: true,
    })
    expect(preservedStep.id).toBe(originalStepId)
  })

  it('retries a record left flagged pendingDeletion by a previous restart, with no seed workflow to reconcile it via', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    // Simulate exactly what a previous restart's reconcile leaves behind
    // when payload.delete() throws on a genuinely stale record: nothing
    // references it - not a workflow, not a run - yet it still exists,
    // flagged pendingDeletion:true instead of silently forgotten. Nothing
    // in THIS restart's seed config names it either, so a diff against a
    // seed workflow's previous triggers/steps could never rediscover it;
    // only a direct query for the flag can.
    const orphanTrigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'Orphaned trigger', type: 'manual', pendingDeletion: true },
      overrideAccess: true,
    })
    const orphanStep = await payload.create({
      collection: 'automation-steps',
      data: { name: 'Orphaned step', type: 'noop-step', pendingDeletion: true },
      overrideAccess: true,
    })

    await payload.destroy()
    payload = undefined

    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    await expect(
      payload.findByID({ collection: 'automation-triggers', id: orphanTrigger.id, overrideAccess: true })
    ).rejects.toThrow()
    await expect(
      payload.findByID({ collection: 'automation-steps', id: orphanStep.id, overrideAccess: true })
    ).rejects.toThrow()
  })

  it('preserves a pendingDeletion-flagged record still referenced by an existing workflow run', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'Flagged but still cited by a run', type: 'manual', pendingDeletion: true },
      overrideAccess: true,
    })
    const workflow = await payload.create({
      collection: 'workflows',
      data: { slug: 'run-referencing-workflow', name: 'Run-referencing workflow' },
      overrideAccess: true,
    })
    await payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: workflow.id,
        firedTrigger: trigger.id,
        status: 'completed',
        startedAt: new Date().toISOString(),
        triggeredBy: 'test',
      },
      overrideAccess: true,
    })

    await payload.destroy()
    payload = undefined

    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    const preserved = await payload.findByID({
      collection: 'automation-triggers',
      id: trigger.id,
      overrideAccess: true,
    })
    expect(preserved.id).toBe(trigger.id)
  })

  it('preserves a pendingDeletion-flagged trigger/step re-selected into a live workflow before the retry runs', async () => {
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    // A previous restart flagged these but the delete failed, leaving them
    // pendingDeletion:true. Nothing references them yet - not a run, not a
    // workflow - so a naive retry would delete both on the next restart.
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'Flagged, then reused', type: 'manual', pendingDeletion: true },
      overrideAccess: true,
    })
    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'Flagged, then reused', type: 'noop-step', pendingDeletion: true },
      overrideAccess: true,
    })

    // Before the next restart, an admin (or any API caller - automation-
    // triggers/automation-steps have no filterOptions hiding flagged docs
    // from the relationship picker) picks the still-flagged records into a
    // brand new workflow. It never fires, so no workflow-run cites them.
    const reusingWorkflow = await payload.create({
      collection: 'workflows',
      data: {
        slug: 'reuses-flagged-records',
        name: 'Reuses flagged records',
        triggers: [trigger.id],
        steps: [{ step: step.id, slug: 'reused-step' }],
      },
      overrideAccess: true,
    })

    await payload.destroy()
    payload = undefined

    // The retry pass runs unconditionally on this restart even with no seed workflows configured.
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [] }))

    const preservedTrigger = await payload.findByID({
      collection: 'automation-triggers',
      id: trigger.id,
      overrideAccess: true,
    })
    expect(preservedTrigger.id).toBe(trigger.id)

    const preservedStep = await payload.findByID({
      collection: 'automation-steps',
      id: step.id,
      overrideAccess: true,
    })
    expect(preservedStep.id).toBe(step.id)

    const workflowStillIntact = await payload.findByID({
      collection: 'workflows',
      id: reusingWorkflow.id,
      depth: 0,
      overrideAccess: true,
    })
    expect(workflowStillIntact.triggers).toContain(trigger.id)
  })
})

describe('workflow readOnly access control', () => {
  let dbFile: string
  let payload: Payload

  beforeEach(async () => {
    dbFile = newDbFile()
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows: [workflowV1] }))
  })

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  const findSeeded = async () => {
    const result = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: workflowV1.slug } },
      overrideAccess: true,
    })
    return result.docs[0] as Record<string, any>
  }

  it('refuses to update a persisted read-only workflow even when the request omits readOnly', async () => {
    const seeded = await findSeeded()
    expect(seeded.readOnly).toBe(true)

    await expect(
      payload.update({
        collection: 'workflows',
        id: seeded.id,
        // Deliberately omits `readOnly` - the persisted value must still govern access.
        data: { name: 'Hacked name' },
        overrideAccess: false,
      })
    ).rejects.toThrow(Forbidden)
  })

  it('refuses to delete a persisted read-only workflow', async () => {
    const seeded = await findSeeded()

    await expect(
      payload.delete({
        collection: 'workflows',
        id: seeded.id,
        overrideAccess: false,
      })
    ).rejects.toThrow(Forbidden)
  })

  it('leaves ordinary, non-read-only workflows editable and deletable', async () => {
    const created = await payload.create({
      collection: 'workflows',
      data: {
        slug: 'user-created-workflow',
        name: 'User Workflow',
      },
      overrideAccess: true,
    })
    expect(created.readOnly).toBe(false)

    const updated = await payload.update({
      collection: 'workflows',
      id: created.id,
      data: { name: 'Renamed by user' },
      overrideAccess: false,
    })
    expect(updated.name).toBe('Renamed by user')

    await expect(
      payload.delete({
        collection: 'workflows',
        id: created.id,
        overrideAccess: false,
      })
    ).resolves.toBeTruthy()
  })
})
