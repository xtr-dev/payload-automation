import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Resolves to the field-level validation errors of a rejected save, as
 * `<path>: <message>`, so a test can assert on which field is marked and on
 * the text an admin user or API client is shown.
 */
const validationMessages = async (save: Promise<unknown>): Promise<string[]> => {
  try {
    await save
  } catch (error) {
    const fieldErrors = (error as { data?: { errors?: { message: string; path: string }[] } }).data?.errors
    if (!fieldErrors) {
      throw error
    }
    return fieldErrors.map((fieldError) => `${fieldError.path}: ${fieldError.message}`)
  }
  throw new Error('Expected the save to be rejected')
}

describe('workflows refuses duplicate or empty step slugs', () => {
  const dbFile = path.join(os.tmpdir(), `payload-automation-step-slugs-${uniqueId()}.db`)
  let payload: Payload
  let stepId: number | string

  beforeAll(async () => {
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'noop', type: noopTask.slug },
    })
    stepId = step.id
  })

  afterAll(async () => {
    await payload.destroy()
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${dbFile}${suffix}`, { force: true })
    }
  })

  const workflowData = (slugs: Array<string | undefined>) => ({
    name: 'step slugs',
    slug: `step-slugs-${uniqueId()}`,
    steps: slugs.map((slug) => ({ slug, step: stepId })),
  })

  const countWorkflows = async () => (await payload.count({ collection: 'workflows' })).totalDocs

  it('accepts steps that each have their own slug', async () => {
    const workflow = await payload.create({ collection: 'workflows', data: workflowData(['first', 'second']) })
    expect(workflow.steps?.map((step) => step.slug)).toEqual(['first', 'second'])
  })

  it('refuses a new workflow in which two steps share a slug, naming the field and the earlier step', async () => {
    const before = await countWorkflows()

    const messages = await validationMessages(
      payload.create({ collection: 'workflows', data: workflowData(['fetch', 'send', 'fetch']) })
    )

    expect(messages).toEqual([
      'steps.2.slug: The slug "fetch" is already used by step 1 of this workflow. Step slugs must be unique within a workflow; give this step a different slug.',
    ])
    expect(await countWorkflows()).toBe(before)
  })

  it('marks every later step that repeats a slug', async () => {
    const messages = await validationMessages(
      payload.create({ collection: 'workflows', data: workflowData(['a', 'a', 'b', 'a', 'b']) })
    )
    expect(messages.map((message) => message.split(':')[0])).toEqual(['steps.1.slug', 'steps.3.slug', 'steps.4.slug'])
  })

  it('refuses an update that gives two steps the same slug and keeps the stored steps', async () => {
    const workflow = await payload.create({ collection: 'workflows', data: workflowData(['first', 'second']) })

    const messages = await validationMessages(
      payload.update({
        collection: 'workflows',
        id: workflow.id,
        data: { steps: [{ slug: 'first', step: stepId }, { slug: 'first', step: stepId }] },
      })
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^steps\.1\.slug: The slug "first" is already used by step 1/)
    const stored = await payload.findByID({ collection: 'workflows', id: workflow.id })
    expect(stored.steps?.map((step) => step.slug)).toEqual(['first', 'second'])
  })

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['missing', undefined],
  ])('refuses a step whose slug is %s', async (_label, slug) => {
    const messages = await validationMessages(
      payload.create({ collection: 'workflows', data: workflowData(['first', slug]) as never })
    )
    expect(messages.some((message) => message.startsWith('steps.1.slug: '))).toBe(true)
  })

  // Payload skips field validation for a draft, but a draft workflow is a
  // stored workflow that runs when its trigger fires.
  it('refuses duplicate slugs when the workflow is saved as a draft', async () => {
    const before = await countWorkflows()

    const messages = await validationMessages(
      payload.create({ collection: 'workflows', data: workflowData(['same', 'same']), draft: true })
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^steps\.1\.slug: /)
    expect(await countWorkflows()).toBe(before)
  })

  it('treats slugs that differ only in case as different, like expressions and dependencies do', async () => {
    const workflow = await payload.create({ collection: 'workflows', data: workflowData(['Fetch', 'fetch']) })
    expect(workflow.steps?.map((step) => step.slug)).toEqual(['Fetch', 'fetch'])
  })

  it('keeps a workflow that was stored with duplicate slugs editable until its slugs change', async ({ skip }) => {
    // The legacy state is built with a raw adapter write below. On MongoDB
    // that write stores the step relation in a form Payload's relationship
    // validation refuses afterwards, so the scenario cannot be set up there;
    // the check itself does not depend on the adapter.
    if (payload.db.name === 'mongoose') {
      skip('the legacy state cannot be written through the MongoDB adapter')
    }
    const workflow = await payload.create({ collection: 'workflows', data: workflowData(['first', 'second']) })
    // Written through the database adapter, which runs no hooks: this is the
    // state of a workflow saved before duplicate slugs were refused.
    // Array rows get their id from a Payload hook, so here they need one; a
    // 24-digit hex string is valid for every adapter.
    const duplicateSteps = [
      { id: '64b000000000000000000001', slug: 'first', step: stepId },
      { id: '64b000000000000000000002', slug: 'first', step: stepId },
    ]
    await payload.db.updateOne({ collection: 'workflows', id: workflow.id, data: { steps: duplicateSteps } })
    // An update starts from the latest version when there is one, which
    // would bring the valid steps back; without versions it starts from the
    // document written above.
    await payload.db.deleteVersions({ collection: 'workflows', where: { parent: { equals: workflow.id } } })

    // A write of other fields, and one that sends the stored steps back
    // unchanged (as the admin panel does on every save), are accepted.
    const disabled = await payload.update({ collection: 'workflows', id: workflow.id, data: { enabled: false } })
    expect(disabled.enabled).toBe(false)
    expect(disabled.steps?.map((step) => step.slug)).toEqual(['first', 'first'])
    const renamed = await payload.update({
      collection: 'workflows',
      id: workflow.id,
      data: { name: 'renamed', steps: duplicateSteps },
    })
    expect(renamed.name).toBe('renamed')

    // Once the slugs change, the new set has to be valid.
    const messages = await validationMessages(
      payload.update({
        collection: 'workflows',
        id: workflow.id,
        data: { steps: [...duplicateSteps, { slug: 'third', step: stepId }] },
      })
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^steps\.1\.slug: /)

    const fixed = await payload.update({
      collection: 'workflows',
      id: workflow.id,
      data: { steps: [duplicateSteps[0], { ...duplicateSteps[1], slug: 'second' }] },
    })
    expect(fixed.steps?.map((step) => step.slug)).toEqual(['first', 'second'])
  })
})
