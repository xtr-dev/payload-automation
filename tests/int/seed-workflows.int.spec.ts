import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

const singleTriggerWorkflow: SeedWorkflow = {
  slug: 'test-seeded-workflow',
  name: 'Test Seeded Workflow',
  description: 'A workflow seeded once at boot',
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

const allTriggerTypesWorkflow: SeedWorkflow = {
  slug: 'test-all-trigger-types',
  name: 'Test All Trigger Types',
  triggers: [
    { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
    { type: 'global-hook', parameters: { globalSlug: 'settings', hook: 'afterChange' } },
    { type: 'scheduled', parameters: { schedule: '0 9 * * *', timezone: 'Europe/Amsterdam' } },
    { type: 'webhook', parameters: { webhookPath: 'my-webhook', webhookSecret: 'seed-test-secret' } },
  ],
  steps: [
    {
      name: 'Step One',
      type: 'noop-step',
      input: {},
    },
  ],
}

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const newDbFile = () => path.join(os.tmpdir(), `payload-automation-test-${uniqueId()}.db`)

// getPayload() caches instances process-wide by `key` (default 'default') and
// destroy() does not clear that cache, so reusing the default key across
// calls silently hands back a previous, already-destroyed instance instead
// of initializing against the new config. Each call needs its own key -
// including the second call that simulates a server restart against the
// same database file.
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

describe('seedWorkflows', () => {
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

  it('creates the workflow, trigger and step records on first boot', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    const workflows = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: singleTriggerWorkflow.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)

    const triggers = await payload.find({ collection: 'automation-triggers', overrideAccess: true })
    expect(triggers.docs).toHaveLength(1)

    const steps = await payload.find({ collection: 'automation-steps', overrideAccess: true })
    expect(steps.docs).toHaveLength(1)

    const workflow = workflows.docs[0] as Record<string, any>
    expect(workflow.readOnly).toBe(true)
    expect(workflow.triggers).toEqual([triggers.docs[0].id])
    expect(workflow.steps).toHaveLength(1)
    expect(workflow.steps[0].step).toBe(steps.docs[0].id)
  })

  it('does not create duplicate records when onInit runs again against the same database', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    await payload.destroy()
    payload = undefined

    // Simulate a server restart: same database file, same seed config, a
    // fresh Payload instance running onInit again.
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [singleTriggerWorkflow] })
    )

    const workflows = await payload.find({
      collection: 'workflows',
      where: { slug: { equals: singleTriggerWorkflow.slug } },
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)

    const triggers = await payload.find({ collection: 'automation-triggers', overrideAccess: true })
    expect(triggers.docs).toHaveLength(1)

    const steps = await payload.find({ collection: 'automation-steps', overrideAccess: true })
    expect(steps.docs).toHaveLength(1)
  })

  it('maps trigger parameters to the correct fields for each trigger type', async () => {
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [allTriggerTypesWorkflow] })
    )

    const triggers = await payload.find({
      collection: 'automation-triggers',
      sort: 'createdAt',
      overrideAccess: true,
    })
    expect(triggers.docs).toHaveLength(4)
    const [collectionHook, globalHook, scheduled, webhook] = triggers.docs as Record<string, any>[]

    expect(collectionHook.type).toBe('collection-hook')
    expect(collectionHook.collectionSlug).toBe('posts')
    expect(collectionHook.hook).toBe('afterChange')

    expect(globalHook.type).toBe('global-hook')
    expect(globalHook.globalSlug).toBe('settings')
    expect(globalHook.hook).toBe('afterChange')

    expect(scheduled.type).toBe('scheduled')
    expect(scheduled.schedule).toBe('0 9 * * *')
    expect(scheduled.timezone).toBe('Europe/Amsterdam')

    expect(webhook.type).toBe('webhook')
    expect(webhook.webhookPath).toBe('my-webhook')
    // The secret from parameters.webhookSecret is write-only: only its hash is stored.
    expect(webhook.webhookSecret ?? undefined).toBeUndefined()
  })

  it('does not seed a workflow whose scheduled trigger has an invalid timezone', async () => {
    const invalidTimezoneWorkflow: SeedWorkflow = {
      slug: 'test-invalid-timezone',
      name: 'Test Invalid Timezone',
      triggers: [
        { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
        { type: 'scheduled', parameters: { schedule: '0 9 * * *', timezone: 'Mars/Olympus_Mons' } },
      ],
      steps: [{ name: 'Step One', type: 'noop-step', input: {} }],
    }
    payload = await getTestPayload(
      buildTestConfig({ dbFile, seedWorkflows: [invalidTimezoneWorkflow] })
    )

    const workflows = await payload.find({ collection: 'workflows', overrideAccess: true })
    expect(workflows.docs).toHaveLength(0)
    // The valid collection-hook trigger before it is not left behind either.
    const triggers = await payload.find({ collection: 'automation-triggers', overrideAccess: true })
    expect(triggers.docs).toHaveLength(0)
  })

  // Boots Payload on the test's database file with the given seed definitions,
  // after shutting down the previous instance: a server restart with new code.
  const boot = async (seedWorkflows: SeedWorkflow[]): Promise<Payload> => {
    if (payload) {
      await payload.destroy()
    }
    payload = await getTestPayload(buildTestConfig({ dbFile, seedWorkflows }))
    return payload
  }

  const findWorkflow = async (slug: string): Promise<Record<string, any>> => {
    const workflows = await payload!.find({
      collection: 'workflows',
      where: { slug: { equals: slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(workflows.docs).toHaveLength(1)
    return workflows.docs[0] as Record<string, any>
  }

  const allIds = async (collection: 'automation-steps' | 'automation-triggers') =>
    (await payload!.find({ collection, limit: 100, overrideAccess: true })).docs.map((doc) => doc.id)

  const twoStepWorkflow: SeedWorkflow = {
    slug: 'test-two-steps',
    name: 'Two Steps',
    description: 'First version',
    triggers: [
      { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
    ],
    steps: [
      { name: 'First', slug: 'first', type: 'noop-step', input: { message: 'v1', nested: { a: 1, b: [1, 2] } } },
      { name: 'Second', slug: 'second', type: 'noop-step', input: {}, dependencies: ['first'] },
    ],
  }

  it('leaves a workflow untouched when its definition has not changed', async () => {
    await boot([twoStepWorkflow, allTriggerTypesWorkflow])
    const before = [await findWorkflow(twoStepWorkflow.slug), await findWorkflow(allTriggerTypesWorkflow.slug)]
    const triggerIdsBefore = await allIds('automation-triggers')
    const stepIdsBefore = await allIds('automation-steps')

    await boot([twoStepWorkflow, allTriggerTypesWorkflow])
    const after = [await findWorkflow(twoStepWorkflow.slug), await findWorkflow(allTriggerTypesWorkflow.slug)]

    // updatedAt only moves when the workflow is written, so equal documents
    // prove the second boot made no update.
    expect(after).toEqual(before)
    expect(await allIds('automation-triggers')).toEqual(triggerIdsBefore)
    expect(await allIds('automation-steps')).toEqual(stepIdsBefore)
  })

  it('updates the stored workflow in place when its definition changes', async () => {
    await boot([twoStepWorkflow])
    const before = await findWorkflow(twoStepWorkflow.slug)

    await boot([
      {
        ...twoStepWorkflow,
        name: 'Two Steps (renamed)',
        description: 'Second version',
        steps: [
          { ...twoStepWorkflow.steps[0], input: { message: 'v2' } },
          twoStepWorkflow.steps[1],
          { name: 'Third', slug: 'third', type: 'noop-step', input: {}, dependencies: ['second'] },
        ],
      },
    ])
    const after = await findWorkflow(twoStepWorkflow.slug)

    expect(after.id).toBe(before.id)
    expect(after.name).toBe('Two Steps (renamed)')
    expect(after.description).toBe('Second version')
    expect(after.readOnly).toBe(true)
    // The trigger did not change, so the same document is still referenced.
    expect(after.triggers).toEqual(before.triggers)

    expect(after.steps.map((step: any) => step.slug)).toEqual(['first', 'second', 'third'])
    expect(after.steps[0].inputOverrides).toEqual({ message: 'v2' })
    // A changed step gets a new step document, an unchanged one keeps its own.
    expect(after.steps[0].step).not.toBe(before.steps[0].step)
    expect(after.steps[1].step).toBe(before.steps[1].step)
    expect(after.steps[2].dependencies.map((dep: any) => dep.slug)).toEqual(['second'])

    // The replaced step document is removed, so no orphans are left.
    const stepIds = await allIds('automation-steps')
    expect(stepIds).toHaveLength(3)
    expect(stepIds).not.toContain(before.steps[0].step)
    const firstStep = await payload!.findByID({ collection: 'automation-steps', id: after.steps[0].step })
    expect(firstStep.config).toEqual({ message: 'v2' })
  })

  it('replaces a changed trigger and removes triggers and steps dropped from the definition', async () => {
    await boot([
      {
        ...twoStepWorkflow,
        triggers: [
          ...twoStepWorkflow.triggers,
          { type: 'scheduled', parameters: { schedule: '0 9 * * *' } },
        ],
      },
    ])
    const before = await findWorkflow(twoStepWorkflow.slug)
    expect(before.triggers).toHaveLength(2)

    await boot([
      {
        ...twoStepWorkflow,
        triggers: [
          { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterDelete' } },
        ],
        steps: [twoStepWorkflow.steps[0]],
      },
    ])
    const after = await findWorkflow(twoStepWorkflow.slug)

    expect(after.triggers).toHaveLength(1)
    expect(before.triggers).not.toContain(after.triggers[0])
    expect(await allIds('automation-triggers')).toEqual(after.triggers)
    const trigger = await payload!.findByID({ collection: 'automation-triggers', id: after.triggers[0] })
    expect(trigger.hook).toBe('afterDelete')

    expect(after.steps).toHaveLength(1)
    expect(after.steps[0].step).toBe(before.steps[0].step)
    expect(await allIds('automation-steps')).toEqual([before.steps[0].step])
  })

  it('applies a reorder of steps without recreating the step documents', async () => {
    const independentSteps: SeedWorkflow = {
      ...twoStepWorkflow,
      steps: [
        { name: 'First', slug: 'first', type: 'noop-step', input: {} },
        { name: 'Second', slug: 'second', type: 'noop-step', input: {} },
      ],
    }
    await boot([independentSteps])
    const before = await findWorkflow(independentSteps.slug)

    await boot([{ ...independentSteps, steps: [independentSteps.steps[1], independentSteps.steps[0]] }])
    const after = await findWorkflow(independentSteps.slug)

    expect(after.steps.map((step: any) => step.slug)).toEqual(['second', 'first'])
    expect(after.steps.map((step: any) => step.step)).toEqual([before.steps[1].step, before.steps[0].step])
    expect(await allIds('automation-steps')).toHaveLength(2)
  })

  it('replaces a webhook trigger when only its secret changes', async () => {
    const webhookWorkflow = (webhookSecret: string): SeedWorkflow => ({
      ...singleTriggerWorkflow,
      triggers: [{ type: 'webhook', parameters: { webhookPath: '/seed-hook/', webhookSecret } }],
    })
    await boot([webhookWorkflow('first-secret')])
    const before = await findWorkflow(singleTriggerWorkflow.slug)

    // Same secret: the stored hash and the normalized path still match.
    await boot([webhookWorkflow('first-secret')])
    expect((await findWorkflow(singleTriggerWorkflow.slug)).triggers).toEqual(before.triggers)

    await boot([webhookWorkflow('second-secret')])
    const after = await findWorkflow(singleTriggerWorkflow.slug)
    expect(after.triggers).toHaveLength(1)
    expect(after.triggers).not.toEqual(before.triggers)
    expect(await allIds('automation-triggers')).toEqual(after.triggers)
  })

  it('overwrites the seeded fields but keeps other settings changed on the stored workflow', async () => {
    await boot([twoStepWorkflow])
    const before = await findWorkflow(twoStepWorkflow.slug)

    // Read-only workflows refuse edits through the admin panel and the API,
    // so these edits can only come from code that bypasses access control.
    await payload!.update({
      collection: 'workflows',
      id: before.id,
      data: { name: 'Renamed by hand', enabled: false, errorHandling: 'continue' },
    })

    // An unchanged definition still differs from the stored name, so the
    // seeded fields are brought back in line with the code.
    await boot([twoStepWorkflow])
    const restored = await findWorkflow(twoStepWorkflow.slug)
    expect(restored.name).toBe(twoStepWorkflow.name)
    // Fields a seed definition does not describe are not reset.
    expect(restored.enabled).toBe(false)
    expect(restored.errorHandling).toBe('continue')
    expect(restored.steps.map((step: any) => step.step)).toEqual(before.steps.map((step: any) => step.step))
  })

  it('keeps a replaced trigger that another workflow still uses', async () => {
    await boot([twoStepWorkflow])
    const before = await findWorkflow(twoStepWorkflow.slug)
    const other = await payload!.create({
      collection: 'workflows',
      data: { name: 'Made in the admin panel', slug: 'handmade', triggers: before.triggers, steps: [] },
    })

    await boot([
      {
        ...twoStepWorkflow,
        triggers: [
          { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterDelete' } },
        ],
      },
    ])
    const after = await findWorkflow(twoStepWorkflow.slug)

    expect(after.triggers).not.toEqual(before.triggers)
    const handmade = await payload!.findByID({ collection: 'workflows', id: other.id, depth: 0 })
    expect(handmade.triggers).toEqual(before.triggers)
    expect(await allIds('automation-triggers')).toHaveLength(2)
  })

  it('leaves no triggers or steps behind when creating a new seeded workflow fails', async () => {
    await boot([
      {
        // The second trigger is refused: a webhook trigger needs a secret.
        slug: 'test-failing-trigger',
        name: 'Failing Trigger',
        triggers: [
          { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
          { type: 'webhook', parameters: { webhookPath: 'no-secret' } },
        ],
        steps: [{ name: 'Step One', type: 'noop-step', input: {} }],
      },
      {
        // The second step is refused: its type is not a registered task.
        slug: 'test-failing-step',
        name: 'Failing Step',
        triggers: [
          { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterChange' } },
        ],
        steps: [
          { name: 'Step One', type: 'noop-step', input: {} },
          { name: 'Step Two', type: 'not-a-registered-step', input: {} },
        ],
      },
      singleTriggerWorkflow,
    ])

    // Only the valid workflow after the two failing ones was seeded.
    const workflows = await payload!.find({ collection: 'workflows', overrideAccess: true })
    expect(workflows.docs.map((doc: any) => doc.slug)).toEqual([singleTriggerWorkflow.slug])
    expect(await allIds('automation-triggers')).toHaveLength(1)
    expect(await allIds('automation-steps')).toHaveLength(1)
  })

  it('keeps the stored workflow and leaves no orphans when updating it fails', async () => {
    await boot([twoStepWorkflow])
    const before = await findWorkflow(twoStepWorkflow.slug)
    const triggerIdsBefore = await allIds('automation-triggers')
    const stepIdsBefore = await allIds('automation-steps')

    await boot([
      {
        ...twoStepWorkflow,
        name: 'Never applied',
        triggers: [
          { type: 'collection-hook', parameters: { collectionSlug: 'posts', hook: 'afterDelete' } },
        ],
        steps: [
          { ...twoStepWorkflow.steps[0], input: { message: 'v2' } },
          { name: 'Broken', slug: 'second', type: 'not-a-registered-step', input: {} },
        ],
      },
    ])

    expect(await findWorkflow(twoStepWorkflow.slug)).toEqual(before)
    expect(await allIds('automation-triggers')).toEqual(triggerIdsBefore)
    expect(await allIds('automation-steps')).toEqual(stepIdsBefore)
  })
})
