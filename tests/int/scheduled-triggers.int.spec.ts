import fs from 'fs'
import os from 'os'
import path from 'path'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import {
  runScheduledTriggers,
  SCHEDULED_TRIGGERS_TASK_SLUG,
} from '../../src/core/scheduled-triggers.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

interface StoredRun {
  firedTrigger?: unknown
  id: number | string
  status: string
  triggerData?: Record<string, unknown>
}

/**
 * Creates a scheduled trigger used by one workflow with one no-op step, and
 * pins the trigger's lastFiredAt to `lastFiredAt` (null leaves it unset, as
 * on a trigger saved before the field existed).
 */
const createScheduledWorkflow = async (
  payload: Payload,
  {
    condition,
    enabled = true,
    lastFiredAt,
    schedule = '0 * * * *',
    timezone,
  }: {
    condition?: string
    enabled?: boolean
    lastFiredAt: null | string
    schedule?: string
    timezone?: string
  },
) => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: `scheduled ${uniqueId()}`, type: 'scheduled', condition, schedule, timezone },
  })
  // Leaves schedule and timezone unchanged, so the save-time baseline in the
  // collection hook does not overwrite the pinned value.
  await payload.update({ collection: 'automation-triggers', id: trigger.id, data: { lastFiredAt } })
  const step = await payload.create({
    collection: 'automation-steps',
    data: { name: 'only', type: noopTask.slug },
  })
  const workflow = await payload.create({
    collection: 'workflows',
    data: {
      name: 'scheduled workflow',
      slug: `scheduled-${uniqueId()}`,
      enabled,
      triggers: [trigger.id],
      steps: [{ step: step.id, slug: 'only', stepName: 'only' }],
    },
  })
  return { triggerId: trigger.id, workflowId: workflow.id }
}

const runsOf = async (payload: Payload, workflowId: number | string) =>
  (
    await payload.find({
      collection: 'workflow-runs',
      depth: 0,
      pagination: false,
      where: { workflow: { equals: workflowId } },
    })
  ).docs as unknown as StoredRun[]

const lastFiredAtOf = async (payload: Payload, triggerId: number | string) =>
  (await payload.findByID({ collection: 'automation-triggers', id: triggerId, depth: 0 }))
    .lastFiredAt as null | string | undefined

const at = (iso: string) => new Date(iso)

/** Behaviour every database adapter must show; the claim differs per adapter. */
const schedulingContract = (getPayloadInstance: () => Payload) => {
  it('fires a trigger once its next occurrence has passed, and records the run', async () => {
    const payload = getPayloadInstance()
    const { triggerId, workflowId } = await createScheduledWorkflow(payload, {
      lastFiredAt: '2026-03-01T10:00:00.000Z',
    })

    await runScheduledTriggers(payload, { now: at('2026-03-01T10:59:59.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)

    const results = await runScheduledTriggers(payload, { now: at('2026-03-01T11:00:05.000Z') })
    expect(results.filter((r) => String(r.workflowId) === String(workflowId))).toMatchObject([
      { status: 'triggered' },
    ])

    const runs = await runsOf(payload, workflowId)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
    expect(String(runs[0].firedTrigger)).toBe(String(triggerId))
    expect(runs[0].triggerData).toMatchObject({
      type: 'scheduled',
      firedAt: '2026-03-01T11:00:05.000Z',
      previousFiredAt: '2026-03-01T10:00:00.000Z',
      schedule: '0 * * * *',
      scheduledAt: '2026-03-01T11:00:00.000Z',
    })
    expect(new Date((await lastFiredAtOf(payload, triggerId))!).toISOString()).toBe(
      '2026-03-01T11:00:05.000Z',
    )

    // The same occurrence does not fire again on a later tick.
    await runScheduledTriggers(payload, { now: at('2026-03-01T11:30:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(1)
  })

  it('fires once for concurrent ticks', async () => {
    const payload = getPayloadInstance()
    const { workflowId } = await createScheduledWorkflow(payload, {
      lastFiredAt: '2026-03-02T10:00:00.000Z',
    })
    const now = at('2026-03-02T11:00:01.000Z')

    await Promise.all(Array.from({ length: 5 }, () => runScheduledTriggers(payload, { now })))

    expect(await runsOf(payload, workflowId)).toHaveLength(1)
  })

  it('fires occurrences missed during downtime once, reporting the latest', async () => {
    const payload = getPayloadInstance()
    const { workflowId } = await createScheduledWorkflow(payload, {
      lastFiredAt: '2026-03-03T10:00:00.000Z',
    })

    await runScheduledTriggers(payload, { now: at('2026-03-03T15:30:00.000Z') })
    await runScheduledTriggers(payload, { now: at('2026-03-03T15:45:00.000Z') })

    const runs = await runsOf(payload, workflowId)
    expect(runs).toHaveLength(1)
    expect(runs[0].triggerData?.scheduledAt).toBe('2026-03-03T15:00:00.000Z')
  })
}

describe('scheduled triggers on SQLite', () => {
  const dbFile = path.join(os.tmpdir(), `payload-automation-scheduled-${uniqueId()}.db`)
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
  })

  afterAll(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  schedulingContract(() => payload)

  it('does not backfill a trigger it has never seen', async () => {
    const { triggerId, workflowId } = await createScheduledWorkflow(payload, { lastFiredAt: null })
    expect(await lastFiredAtOf(payload, triggerId)).toBeFalsy()

    await runScheduledTriggers(payload, { now: at('2026-03-04T10:30:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)
    expect(new Date((await lastFiredAtOf(payload, triggerId))!).toISOString()).toBe(
      '2026-03-04T10:30:00.000Z',
    )

    await runScheduledTriggers(payload, { now: at('2026-03-04T11:00:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(1)
  })

  it('skips disabled workflows and does not fire them for the skipped occurrence later', async () => {
    const { triggerId, workflowId } = await createScheduledWorkflow(payload, {
      enabled: false,
      lastFiredAt: '2026-03-05T10:00:00.000Z',
    })

    await runScheduledTriggers(payload, { now: at('2026-03-05T11:00:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)

    await payload.update({ collection: 'workflows', id: workflowId, data: { enabled: true } })
    await runScheduledTriggers(payload, { now: at('2026-03-05T11:30:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)

    await runScheduledTriggers(payload, { now: at('2026-03-05T12:00:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(1)
    expect(new Date((await lastFiredAtOf(payload, triggerId))!).toISOString()).toBe(
      '2026-03-05T12:00:00.000Z',
    )
  })

  it('respects the trigger condition', async () => {
    const skipped = await createScheduledWorkflow(payload, {
      condition: 'trigger.type = "webhook"',
      lastFiredAt: '2026-03-06T10:00:00.000Z',
    })
    const matching = await createScheduledWorkflow(payload, {
      condition: 'trigger.type = "scheduled" and trigger.scheduledAt = "2026-03-06T11:00:00.000Z"',
      lastFiredAt: '2026-03-06T10:00:00.000Z',
    })

    const results = await runScheduledTriggers(payload, { now: at('2026-03-06T11:00:00.000Z') })

    expect(results.find((r) => String(r.workflowId) === String(skipped.workflowId))?.status).toBe(
      'skipped',
    )
    expect(await runsOf(payload, skipped.workflowId)).toHaveLength(0)
    expect(await runsOf(payload, matching.workflowId)).toHaveLength(1)
  })

  it('evaluates the schedule in the trigger timezone', async () => {
    // 09:00 in Amsterdam is 08:00 UTC in winter.
    const { workflowId } = await createScheduledWorkflow(payload, {
      lastFiredAt: '2026-01-10T07:00:00.000Z',
      schedule: '0 9 * * *',
      timezone: 'Europe/Amsterdam',
    })

    await runScheduledTriggers(payload, { now: at('2026-01-10T07:59:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)

    await runScheduledTriggers(payload, { now: at('2026-01-10T08:00:30.000Z') })
    const runs = await runsOf(payload, workflowId)
    expect(runs).toHaveLength(1)
    expect(runs[0].triggerData).toMatchObject({
      scheduledAt: '2026-01-10T08:00:00.000Z',
      timezone: 'Europe/Amsterdam',
    })
  })

  it('sets lastFiredAt to the save time when the schedule is created or changed', async () => {
    const before = Date.now()
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'baseline', type: 'scheduled', schedule: '0 * * * *' },
    })
    const created = new Date(trigger.lastFiredAt as string).getTime()
    expect(created).toBeGreaterThanOrEqual(before)

    await payload.update({
      collection: 'automation-triggers',
      id: trigger.id,
      data: { lastFiredAt: '2020-01-01T00:00:00.000Z' },
    })
    await payload.update({ collection: 'automation-triggers', id: trigger.id, data: { name: 'renamed' } })
    expect(new Date((await lastFiredAtOf(payload, trigger.id))!).toISOString()).toBe(
      '2020-01-01T00:00:00.000Z',
    )

    await payload.update({
      collection: 'automation-triggers',
      id: trigger.id,
      data: { schedule: '30 * * * *' },
    })
    expect(new Date((await lastFiredAtOf(payload, trigger.id))!).getTime()).toBeGreaterThanOrEqual(
      before,
    )
  })

  it('refuses client-supplied lastFiredAt values', async () => {
    const user = await payload.create({
      collection: 'users',
      data: { email: `${uniqueId()}@example.com`, password: 'secret-password' },
    })
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'access', type: 'scheduled', schedule: '0 * * * *' },
    })
    const stored = await lastFiredAtOf(payload, trigger.id)

    await payload.update({
      collection: 'automation-triggers',
      id: trigger.id,
      data: { lastFiredAt: '2000-01-01T00:00:00.000Z' },
      overrideAccess: false,
      user: { ...user, collection: 'users' },
    })

    expect(await lastFiredAtOf(payload, trigger.id)).toBe(stored)
  })

  it('rejects invalid cron expressions and timezones on save', async () => {
    await expect(
      payload.create({
        collection: 'automation-triggers',
        data: { name: 'bad cron', type: 'scheduled', schedule: 'every day' },
      }),
    ).rejects.toThrow(/Invalid cron expression/)
    await expect(
      payload.create({
        collection: 'automation-triggers',
        data: { name: 'bad tz', type: 'scheduled', schedule: '0 * * * *', timezone: 'Nowhere/City' },
      }),
    ).rejects.toThrow(/Invalid timezone/)
  })

  it('is scheduled with Payload and fires through the job runner', async () => {
    const task = payload.config.jobs.tasks?.find((t) => t.slug === SCHEDULED_TRIGGERS_TASK_SLUG)
    expect(task?.schedule).toEqual([{ cron: '* * * * *', queue: 'default' }])
    expect(payload.config.jobs.scheduling).toBe(true)

    const { queued } = await payload.jobs.handleSchedules()
    expect(queued.map((q) => q.taskConfig?.slug)).toContain(SCHEDULED_TRIGGERS_TASK_SLUG)

    // Real time from here on: an every-minute schedule last fired an hour ago is due.
    const { workflowId } = await createScheduledWorkflow(payload, {
      lastFiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      schedule: '* * * * *',
    })
    await payload.jobs.queue({ input: {}, task: SCHEDULED_TRIGGERS_TASK_SLUG as never } as never)
    await payload.jobs.run()

    const runs = await runsOf(payload, workflowId)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('completed')
  })
})

describe('scheduled trigger options', () => {
  it('registers the task with the configured tick and queue, or not at all', async () => {
    const custom = await buildTestConfig({
      dbFile: '',
      pluginOptions: { scheduledTriggers: { queue: 'automation', tick: '*/5 * * * *' } },
    })
    expect(
      custom.jobs.tasks?.find((t) => t.slug === SCHEDULED_TRIGGERS_TASK_SLUG)?.schedule,
    ).toEqual([{ cron: '*/5 * * * *', queue: 'automation' }])

    const disabled = await buildTestConfig({ dbFile: '', pluginOptions: { scheduledTriggers: false } })
    expect(disabled.jobs.tasks?.find((t) => t.slug === SCHEDULED_TRIGGERS_TASK_SLUG)).toBeUndefined()
  })
})

describe('scheduled triggers on MongoDB', () => {
  let mongo: MongoMemoryReplSet
  let payload: Payload

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    payload = await getPayload({
      config: buildTestConfig({
        // Transactions off: a fresh in-memory server creates collections on
        // first write, which aborts multi-document transactions.
        db: mongooseAdapter({ transactionOptions: false, url: mongo.getUri('payload-automation-scheduled') }),
        dbFile: '',
      }),
      key: uniqueId(),
    })
  }, 240000)

  afterAll(async () => {
    await payload?.destroy()
    await mongo?.stop()
  })

  schedulingContract(() => payload)

  it('does not backfill a trigger it has never seen', async () => {
    const { workflowId } = await createScheduledWorkflow(payload, { lastFiredAt: null })
    await runScheduledTriggers(payload, { now: at('2026-03-04T10:30:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(0)
    await runScheduledTriggers(payload, { now: at('2026-03-04T11:00:00.000Z') })
    expect(await runsOf(payload, workflowId)).toHaveLength(1)
  })
})
