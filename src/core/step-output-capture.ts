import type { Payload, TaskConfig, TaskHandler } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import { redactStepOutput } from './redact-fields.js'
import { getSharedState } from './shared-state.js'

/**
 * Hands a step's output from its task handler to the WorkflowExecutor.
 *
 * The executor runs each step as a Payload job and needs the task's output
 * afterwards. Payload's job runner only reports a status, and with the default
 * `jobs.deleteJobOnComplete: true` it deletes the job row (and the output
 * logged in it) before `runByID` returns. So the plugin wraps every task
 * handler: when the executor has registered a slot for the job being run, the
 * wrapper stores the handler's output in it.
 *
 * Slots are keyed by Payload instance and job id. The executor keeps a
 * reference to its own slot and only removes the map entry if it still points
 * at that slot, so a job id reused by the database after deletion cannot steal
 * or drop another run's output.
 */

export type StepOutputSlot = {
  captured: boolean
  output?: Record<string, unknown>
}

// Shared between all copies of the plugin in the process: the wrapped handler
// lives in the copy that built the Payload config, while the executor that
// registers the slot can be another copy (see shared-state.ts). With a
// module-level map the handler would look in a different map than the one the
// executor wrote to, and every step output would be lost.
const slotsByPayload = getSharedState(
  'stepOutputSlots',
  () => new WeakMap<Payload, Map<string, StepOutputSlot>>()
)

const WRAPPED = Symbol.for('payload-automation.stepOutputCapture')

/** Registers a slot that the wrapped handler of job `jobId` fills with its output. */
export const expectStepOutput = (payload: Payload, jobId: number | string): StepOutputSlot => {
  let slots = slotsByPayload.get(payload)
  if (!slots) {
    slots = new Map()
    slotsByPayload.set(payload, slots)
  }
  const slot: StepOutputSlot = { captured: false }
  slots.set(String(jobId), slot)
  return slot
}

/** Removes the slot registered by {@link expectStepOutput}, if it is still the current one. */
export const releaseStepOutput = (payload: Payload, jobId: number | string, slot: StepOutputSlot): void => {
  const slots = slotsByPayload.get(payload)
  if (slots?.get(String(jobId)) === slot) {
    slots.delete(String(jobId))
  }
}

/**
 * Returns a copy of `task` whose handler records its successful output in the
 * slot registered for the running job. Tasks whose handler is a module path
 * string are returned unchanged; the executor then falls back to reading the
 * output from the job document, which only works while the job still exists.
 */
export const withStepOutputCapture = <T extends TaskConfig<any>>(task: T): T => {
  const handler = task.handler
  if (typeof handler !== 'function' || (handler as unknown as Record<symbol, unknown>)[WRAPPED]) {
    return task
  }

  const wrapped: TaskHandler<any> = async (args) => {
    let result = await handler(args)
    // Fields the host keeps out of workflow runs (`redactFields`) are removed
    // from a document step's output here, before Payload's job runner writes
    // the output into the job's log in `payload-jobs`.
    const output = (result as { output?: unknown } | undefined)?.output
    // Read without getPluginConfig, which throws when the options are
    // missing: a wrapped task must keep working whatever the config holds.
    const redactFields = (args.req.payload.config.custom?.pluginConfigs?.['@xtr-dev/payload-automation'] as
      | undefined
      | WorkflowsPluginConfig)?.redactFields
    if (output && redactFields) {
      const redacted = redactStepOutput(args.req.payload, redactFields, args.input, output)
      if (redacted !== output) {
        result = { ...result, output: redacted } as typeof result
      }
    }
    const slot = slotsByPayload.get(args.req.payload)?.get(String(args.job.id))
    if (slot && result && result.state !== 'failed') {
      slot.captured = true
      slot.output = (result as { output?: Record<string, unknown> }).output ?? {}
    }
    return result
  }
  Object.defineProperty(wrapped, WRAPPED, { value: true, enumerable: false })

  return { ...task, handler: wrapped }
}
