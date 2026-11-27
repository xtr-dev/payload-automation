import type { Payload, PayloadRequest } from 'payload'

import { createLocalReq } from 'payload'

import { initializeLogger } from '../plugin/logger.js'
import {
  type ExecutionContext,
  type PayloadWorkflow,
  type PreviousStepResult,
  WorkflowExecutor
} from './workflow-executor.js'

export interface RetryWorkflowRunOptions {
  /**
   * Request to run the retry with. Defaults to a local request without a
   * user, the same as a workflow started from `onInit` or a job.
   */
  req?: PayloadRequest

  /**
   * Skip the steps that succeeded in the original run and start at the first
   * step that did not. A skipped step's stored input and output are copied
   * into the new run, so later steps can still read `steps.<slug>.output`.
   * A step only counts as already done when it sits at the same position,
   * references the same `automation-steps` document and has the same slug as
   * before, so steps that were added, removed, reordered or given another slug
   * since then run again. Runs stored before step results recorded their slug
   * are matched on position and step document only.
   *
   * Defaults to `false`: every step runs again.
   */
  resumeFromFailedStep?: boolean
}

/**
 * The run statuses `retryWorkflowRun` refuses. Retrying a run that is still
 * pending or running would execute its steps twice at the same time.
 */
const IN_FLIGHT_STATUSES = new Set(['pending', 'running'])

const relationId = (value: unknown): number | string | undefined => {
  if (typeof value === 'string' || typeof value === 'number') {
    return value
  }
  if (value !== null && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') {
      return id
    }
  }
  return undefined
}

/**
 * Run a workflow again from an earlier run's stored `triggerData`, and return
 * the new `workflow-runs` document. The original run is left untouched.
 *
 * The workflow's current definition is used (not a snapshot from the original
 * run), the trigger condition is not evaluated again, and the run happens even
 * if the workflow has been disabled since: a retry is an explicit request.
 * Expressions see `trigger` as it was serialized on the original run, so
 * values that were never stored (the live `req`, the Payload instance) are
 * not available.
 *
 * The retry runs inline, in the calling request, even when the plugin is
 * configured with `execution: { mode: 'queue' }`, so the returned run is
 * finished, never `pending`.
 *
 * A failing step does not make this throw: the returned run then has
 * `status: 'failed'`. It does throw when the original run is missing, still
 * pending or running, or the workflow no longer exists.
 *
 * @example
 * ```typescript
 * import { retryWorkflowRun } from '@xtr-dev/payload-automation/server'
 *
 * const newRun = await retryWorkflowRun(payload, failedRunId, { resumeFromFailedStep: true })
 * console.log(newRun.status) // 'completed' or 'failed'
 * ```
 */
export async function retryWorkflowRun(
  payload: Payload,
  runId: number | string,
  options: RetryWorkflowRunOptions = {}
): Promise<Record<string, unknown> & { id: number | string; status: string }> {
  const logger = initializeLogger(payload)
  const req = options.req ?? await createLocalReq({}, payload)

  const originalRun = await payload.findByID({
    collection: 'workflow-runs',
    id: runId,
    depth: 0,
    req
  })

  if (IN_FLIGHT_STATUSES.has(originalRun.status as string)) {
    throw new Error(`Workflow run ${runId} is still ${originalRun.status as string} and cannot be retried`)
  }

  const workflowId = relationId(originalRun.workflow)
  if (workflowId === undefined) {
    throw new Error(`Workflow run ${runId} has no workflow`)
  }

  const workflow = await payload.findByID({
    collection: 'workflows',
    id: workflowId,
    depth: 2,
    req
  })

  const firedTriggerId = relationId(originalRun.firedTrigger)
  let firedTrigger: undefined | { id: number | string; name?: string }
  if (firedTriggerId !== undefined) {
    try {
      firedTrigger = await payload.findByID({
        collection: 'automation-triggers',
        id: firedTriggerId,
        depth: 0,
        req
      }) as { id: number | string; name?: string }
    } catch {
      // The trigger was deleted since; the retry still runs, just unlinked.
      firedTrigger = undefined
    }
  }

  const context: ExecutionContext = {
    steps: {},
    trigger: (originalRun.triggerData as ExecutionContext['trigger'] | null | undefined) ?? {}
  }

  logger.info({
    originalRunId: runId,
    resumeFromFailedStep: options.resumeFromFailedStep === true,
    workflowId
  }, 'Retrying workflow run')

  const executor = new WorkflowExecutor(payload, logger)
  let newRunId: number | string | undefined
  try {
    await executor.execute(workflow as unknown as PayloadWorkflow, context, req, firedTrigger, {
      // A retry is an explicit request for a result, so it runs inline even
      // when the plugin queues trigger-fired runs (execution.mode 'queue').
      inline: true,
      onRunCreated: (id) => {
        newRunId = id
      },
      reuseSucceededSteps: options.resumeFromFailedStep
        ? (originalRun.stepResults as PreviousStepResult[] | null | undefined) ?? []
        : undefined,
      startMessage: `Workflow execution started (retry of run ${runId})`
    })
  } catch (error) {
    // A step failure is already recorded on the new run; anything that
    // happened before the run existed is a real error for the caller.
    if (newRunId === undefined) {
      throw error
    }
  }

  return await payload.findByID({
    collection: 'workflow-runs',
    id: newRunId!,
    depth: 0,
    req
  }) as Record<string, unknown> & { id: number | string; status: string }
}
