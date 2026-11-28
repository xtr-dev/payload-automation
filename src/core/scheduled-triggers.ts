import type { Cron } from 'croner'
import type { Payload, PayloadRequest, TaskConfig, Where } from 'payload'

import { createLocalReq } from 'payload'

import type { ExecutionContext, PayloadWorkflow } from './workflow-executor.js'

import { initializeLogger } from '../plugin/logger.js'
import { parseSchedule } from '../utils/schedule.js'
import { WorkflowExecutor } from './workflow-executor.js'

/**
 * Slug of the job task that fires due `scheduled` triggers. The plugin
 * registers it with a Payload `schedule`, so Payload's scheduler queues it on
 * every tick (see `scheduledTriggers` in the plugin options).
 */
export const SCHEDULED_TRIGGERS_TASK_SLUG = 'automation-scheduled-triggers'

/** Default cadence at which due scheduled triggers are looked for: every minute. */
export const DEFAULT_SCHEDULED_TRIGGERS_TICK = '* * * * *'

/**
 * Upper bound on the occurrences walked to find the latest one that passed
 * while no tick ran. Only affects the reported `trigger.scheduledAt` after
 * very long downtime with a very frequent schedule: the trigger still fires
 * exactly once either way.
 */
const MAX_MISSED_OCCURRENCES_WALKED = 10_000

interface ScheduledTriggerDoc {
  condition?: null | string
  id: number | string
  lastFiredAt?: null | string
  name?: string
  schedule?: null | string
  timezone?: null | string
}

export interface ScheduledTriggerResult {
  /**
   * `true` when the run finished and was deleted from `workflow-runs`
   * because the workflow's `discardRunWhen` expression was true. `runId` then
   * refers to a run that is no longer stored.
   */
  discarded?: boolean
  error?: string
  /** Id of the `workflow-runs` record, when one was created. */
  runId?: number | string
  status: 'failed' | 'skipped' | 'triggered'
  triggerId: number | string
  workflowId: number | string
}

export interface RunScheduledTriggersOptions {
  /**
   * The time to evaluate schedules against. Defaults to the current time;
   * tests pass a fixed value.
   */
  now?: Date
  /**
   * Request the workflows run with. Defaults to a local request without a
   * user, like the one Payload's job runner passes to tasks.
   */
  req?: PayloadRequest
}

/** Latest occurrence of `cron` that is at or after `first` and not after `now`. */
const latestOccurrence = (cron: Cron, first: Date, now: Date): Date => {
  let latest = first
  for (let i = 0; i < MAX_MISSED_OCCURRENCES_WALKED; i++) {
    const next = cron.nextRun(latest)
    if (!next || next.getTime() > now.getTime()) {
      break
    }
    latest = next
  }
  return latest
}

type ClaimCondition =
  /** Matches only while the trigger has never been seen by the scheduler. */
  | { kind: 'unset' }
  /** Matches only while the stored lastFiredAt is before the due occurrence. */
  | { before: Date; kind: 'before' }

/**
 * Atomically sets `lastFiredAt` to `now` on a trigger, but only while it still
 * matches `condition`. Returns `false` when another tick (in this process or
 * another instance) got there first.
 *
 * The condition compares against the due occurrence rather than the value
 * read earlier: every tick that saw the same `lastFiredAt` computes the same
 * due occurrence, and the first claim moves `lastFiredAt` to a time at or
 * after it, so the others no longer match. Comparing timestamps with `<`
 * also avoids relying on exact equality of stored dates.
 *
 * - MongoDB: the adapter's `updateOne` with a `where` is a single
 *   `findOneAndUpdate`, which matches and writes atomically.
 * - SQL adapters (Postgres, SQLite): one `UPDATE ... WHERE ... RETURNING id`
 *   statement through the adapter's `execute`. Dates are stored as ISO
 *   strings on SQLite (which compare correctly as text) and as timestamptz
 *   on Postgres (which casts the literal).
 * - Any other adapter: a conditional `payload.update`, which is best-effort
 *   under concurrency.
 */
const claimTrigger = async (
  payload: Payload,
  req: PayloadRequest,
  triggerId: number | string,
  condition: ClaimCondition,
  now: Date
): Promise<boolean> => {
  const nowISO = now.toISOString()
  const where: Where = {
    and: [
      { id: { equals: triggerId } },
      condition.kind === 'unset'
        ? { lastFiredAt: { equals: null } }
        : { lastFiredAt: { less_than: condition.before.toISOString() } },
    ],
  }

  const db = payload.db as unknown as {
    drizzle?: unknown
    execute?: (args: { db?: unknown; drizzle?: unknown; raw: string }) => Promise<unknown>
    name?: string
    schemaName?: string
    sessions?: Record<string, { db?: unknown }>
    tableNameMap?: Map<string, string>
  }

  if (db.name === 'mongoose') {
    const claimed = await payload.db.updateOne({
      collection: 'automation-triggers',
      data: { lastFiredAt: now },
      req,
      where,
    })
    return claimed !== null
  }

  if (db.drizzle && typeof db.execute === 'function' && db.tableNameMap) {
    // Values are inlined into raw SQL, so only accept ids made of safe
    // characters; the timestamps come from Date.toISOString and are safe.
    const idText = String(triggerId)
    if (!/^[\w-]+$/.test(idText)) {
      throw new Error(`Unexpected trigger id: ${idText}`)
    }
    const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
    const tableName = db.tableNameMap.get('automation_triggers') ?? 'automation_triggers'
    const table = db.schemaName ? `${quote(db.schemaName)}.${quote(tableName)}` : quote(tableName)
    const idLiteral = typeof triggerId === 'number' ? idText : `'${idText}'`
    const conditionSql =
      condition.kind === 'unset'
        ? `"last_fired_at" IS NULL`
        : `"last_fired_at" < '${condition.before.toISOString()}'`

    // Run inside the request's transaction when there is one, so the claim
    // does not wait on a lock that same transaction holds.
    const transactionID = req.transactionID instanceof Promise ? await req.transactionID : req.transactionID
    const session = transactionID !== undefined ? db.sessions?.[String(transactionID)]?.db : undefined

    const result = (await db.execute({
      db: session,
      drizzle: db.drizzle,
      raw: `UPDATE ${table} SET "last_fired_at" = '${nowISO}' WHERE "id" = ${idLiteral} AND ${conditionSql} RETURNING "id"`,
    })) as { rows?: unknown[] } | undefined
    return (result?.rows?.length ?? 0) > 0
  }

  const claimed = await payload.update({
    collection: 'automation-triggers',
    data: { lastFiredAt: nowISO },
    req,
    where,
  })
  if (claimed.errors.length > 0) {
    throw new Error(
      `Could not claim scheduled trigger ${String(triggerId)}: ${claimed.errors.map((e) => e.message).join('; ')}`
    )
  }
  return claimed.docs.length > 0
}

const relationIds = (value: unknown): (number | string)[] =>
  Array.isArray(value)
    ? value.map((item) =>
        typeof item === 'object' && item !== null ? (item as { id: number | string }).id : (item as number | string)
      )
    : []

/**
 * Fires every `scheduled` trigger whose next occurrence after its
 * `lastFiredAt` is at or before `now`, running each enabled workflow that
 * references it through the `WorkflowExecutor`, like hook and webhook
 * triggers do.
 *
 * Semantics:
 * - Each due trigger is claimed before anything runs (see `claimTrigger`), so
 *   overlapping ticks and multiple server instances fire an occurrence once.
 *   Firing is at-most-once: a crash between the claim and the run loses that
 *   occurrence rather than repeating it.
 * - Occurrences missed while no tick ran (downtime, a stopped job runner)
 *   fire once in total, not once per occurrence; `trigger.scheduledAt` is the
 *   latest missed occurrence.
 * - A trigger without `lastFiredAt` (saved before this field existed, or
 *   written around the collection hooks) is not backfilled: the first tick
 *   records the current time and only later occurrences fire. Saving a
 *   trigger with a new schedule sets `lastFiredAt` to the save time for the
 *   same reason.
 * - Occurrences are consumed even when no enabled workflow uses the trigger
 *   or its condition is false, so enabling a workflow later does not fire it
 *   for occurrences that passed while it was disabled.
 */
export const runScheduledTriggers = async (
  payload: Payload,
  options: RunScheduledTriggersOptions = {}
): Promise<ScheduledTriggerResult[]> => {
  const now = options.now ?? new Date()
  const logger = initializeLogger(payload)
  const req = options.req ?? (await createLocalReq({}, payload))

  const { docs } = await payload.find({
    collection: 'automation-triggers',
    depth: 0,
    pagination: false,
    req,
    where: { type: { equals: 'scheduled' } },
  })
  const triggers = docs as unknown as ScheduledTriggerDoc[]

  const results: ScheduledTriggerResult[] = []
  const firing: Array<{ context: ExecutionContext; trigger: ScheduledTriggerDoc }> = []

  for (const trigger of triggers) {
    if (!trigger.schedule) {
      continue
    }

    let cron: Cron
    try {
      cron = parseSchedule(trigger.schedule, trigger.timezone)
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          schedule: trigger.schedule,
          triggerId: trigger.id,
        },
        'Skipping scheduled trigger with an invalid cron expression'
      )
      continue
    }

    try {
      if (!trigger.lastFiredAt) {
        await claimTrigger(payload, req, trigger.id, { kind: 'unset' }, now)
        continue
      }

      const due = cron.nextRun(new Date(trigger.lastFiredAt))
      if (!due || due.getTime() > now.getTime()) {
        continue
      }

      if (!(await claimTrigger(payload, req, trigger.id, { before: due, kind: 'before' }, now))) {
        logger.debug({ triggerId: trigger.id }, 'Scheduled trigger was already fired by another tick')
        continue
      }

      const scheduledAt = latestOccurrence(cron, due, now)
      firing.push({
        context: {
          steps: {},
          trigger: {
            type: 'scheduled',
            firedAt: now.toISOString(),
            firedTrigger: trigger,
            previousFiredAt: trigger.lastFiredAt,
            schedule: trigger.schedule,
            scheduledAt: scheduledAt.toISOString(),
            timezone: trigger.timezone ?? null,
            triggeredAt: now.toISOString(),
          },
        },
        trigger,
      })
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          triggerId: trigger.id,
        },
        'Failed to claim scheduled trigger'
      )
    }
  }

  if (firing.length === 0) {
    return results
  }

  const { docs: workflows } = await payload.find({
    collection: 'workflows',
    depth: 2,
    pagination: false,
    req,
    where: {
      enabled: { equals: true },
      triggers: { in: firing.map(({ trigger }) => trigger.id) },
    },
  })

  const executor = new WorkflowExecutor(payload, logger)

  for (const { context, trigger } of firing) {
    for (const workflow of workflows) {
      if (!relationIds(workflow.triggers).some((id) => String(id) === String(trigger.id))) {
        continue
      }

      if (trigger.condition) {
        try {
          if (!(await executor.evaluateCondition(trigger.condition, context))) {
            logger.debug(
              { triggerId: trigger.id, workflowId: workflow.id },
              'Scheduled workflow skipped due to unmet trigger condition'
            )
            results.push({ status: 'skipped', triggerId: trigger.id, workflowId: workflow.id })
            continue
          }
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              triggerId: trigger.id,
              workflowId: workflow.id,
            },
            'Failed to evaluate scheduled trigger condition'
          )
          results.push({
            error: 'Failed to evaluate trigger condition',
            status: 'failed',
            triggerId: trigger.id,
            workflowId: workflow.id,
          })
          continue
        }
      }

      let runId: number | string | undefined
      let discarded = false
      try {
        runId = await executor.execute(workflow as unknown as PayloadWorkflow, context, req, trigger, {
          onRunCreated: (id) => {
            runId = id
          },
          onRunDiscarded: () => {
            discarded = true
          },
        })
        results.push({
          ...(discarded ? { discarded } : {}),
          runId,
          status: 'triggered',
          triggerId: trigger.id,
          workflowId: workflow.id,
        })
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            triggerId: trigger.id,
            workflowId: workflow.id,
          },
          'Scheduled workflow execution failed'
        )
        results.push({
          error: error instanceof Error ? error.message : 'Unknown error',
          runId,
          status: 'failed',
          triggerId: trigger.id,
          workflowId: workflow.id,
        })
      }
    }
  }

  logger.info(
    { firedTriggers: firing.length, workflowRuns: results.length },
    'Scheduled triggers processed'
  )

  return results
}

/**
 * Job task that fires due scheduled triggers. Registered by the plugin with
 * `schedule: [{ cron: tick, queue }]`, so Payload's scheduler queues it once
 * per tick; the host's job runner then runs it.
 *
 * Workflow failures are recorded on their `workflow-runs` records and the
 * task still succeeds. Retries stay at 0: the claim already consumed the
 * occurrences, so a retry would have nothing to fire anyway.
 */
export const createScheduledTriggersTask = (tick: string, queue: string): TaskConfig<string> => ({
  slug: SCHEDULED_TRIGGERS_TASK_SLUG,
  handler: async ({ req }) => {
    const results = await runScheduledTriggers(req.payload, { req })
    return { output: { workflowRuns: results.length } }
  },
  label: 'Fire scheduled automation triggers',
  outputSchema: [{ name: 'workflowRuns', type: 'number' }],
  retries: 0,
  schedule: [{ cron: tick, queue }],
})
