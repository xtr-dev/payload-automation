import type { Payload, TaskConfig, TaskHandler } from 'payload'

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

const slotsByPayload = new WeakMap<Payload, Map<string, StepOutputSlot>>()

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
    const result = await handler(args)
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
