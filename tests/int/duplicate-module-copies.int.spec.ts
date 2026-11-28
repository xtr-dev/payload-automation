import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * A bundler can load this plugin twice in one process. Next.js does so when
 * Payload is initialised from `instrumentation.ts`: that file is bundled
 * separately from the app, so the config (and the task handlers the plugin
 * wrapped in it) comes from one copy of the plugin while a server action that
 * calls `triggerWorkflowById` runs another copy. Both copies work on the same
 * Payload instance, because Payload caches it on `globalThis`.
 *
 * These tests reproduce that with `vi.resetModules()`: the config is built
 * from one evaluation of the plugin's source, the workflow is started from a
 * second one. `payload` itself is an external dependency that Vitest does not
 * re-evaluate, exactly as in the bundled app.
 */

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

const produceTask: TaskConfig<string> = {
  slug: 'produce-step',
  label: 'Produce',
  handler: () => Promise.resolve({ output: { greeting: 'hello' }, state: 'succeeded' }),
}

// Inputs the consume step received at runtime.
const consumedInputs: Array<Record<string, unknown>> = []
const consumeTask: TaskConfig<string> = {
  slug: 'consume-step',
  label: 'Consume',
  handler: ({ input }) => {
    consumedInputs.push(input as Record<string, unknown>)
    return Promise.resolve({ output: {}, state: 'succeeded' })
  },
}

/** A manually triggered workflow: `produce`, then `consume` reading produce's output. */
const createManualWorkflow = async (payload: Payload): Promise<string> => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'manual', type: 'manual' },
  })
  const produce = await payload.create({
    collection: 'automation-steps',
    data: { name: 'produce', type: produceTask.slug },
  })
  const consume = await payload.create({
    collection: 'automation-steps',
    data: {
      name: 'consume',
      type: consumeTask.slug,
      config: { greeting: '{{steps.produce.output.greeting}}' },
    },
  })
  const workflow = await payload.create({
    collection: 'workflows',
    data: {
      name: 'produce then consume',
      slug: `produce-consume-${uniqueId()}`,
      triggers: [trigger.id],
      steps: [
        { step: produce.id, slug: 'produce', stepName: 'produce' },
        { step: consume.id, slug: 'consume', stepName: 'consume', dependencies: [{ slug: 'produce' }] },
      ],
    },
  })
  return String(workflow.id)
}

type StoredRun = {
  status: string
  stepResults?: Array<{ output?: Record<string, unknown>; stepName?: string }>
}

describe('two copies of the plugin in one process', () => {
  let dbFile: string
  let payload: Payload | undefined

  afterEach(async () => {
    if (payload) {
      await payload.destroy()
      payload = undefined
    }
    removeDbFile(dbFile)
    consumedInputs.length = 0
  })

  /** Initialises Payload with a config built by a fresh evaluation of the plugin. */
  const initFromFirstCopy = async (): Promise<Payload> => {
    vi.resetModules()
    const { buildTestConfig, noopTask } = await import('./build-test-config.js')
    dbFile = path.join(os.tmpdir(), `payload-automation-copies-${uniqueId()}.db`)
    return getPayload({
      config: buildTestConfig({
        dbFile,
        pluginOptions: { steps: [noopTask, produceTask, consumeTask] },
      }),
      key: uniqueId(),
    })
  }

  it('evaluates the plugin source again after a module reset', async () => {
    // Guards the premise of this file: without two distinct module instances
    // the tests below would pass even with state kept at module scope.
    const first = await import('../../src/core/trigger-custom-workflow.js')
    vi.resetModules()
    const second = await import('../../src/core/trigger-custom-workflow.js')

    expect(second.triggerWorkflowById).not.toBe(first.triggerWorkflowById)
  })

  it('passes step outputs on when the run is started from a copy other than the one that built the config', async () => {
    payload = await initFromFirstCopy()
    const workflowId = await createManualWorkflow(payload)

    vi.resetModules()
    const { triggerWorkflowById } = await import('../../src/core/trigger-custom-workflow.js')
    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    expect(result.status).toBe('triggered')
    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
    expect(docs).toHaveLength(1)
    const run = docs[0] as unknown as StoredRun
    expect(run.status).toBe('completed')
    expect(run.stepResults?.find((r) => r.stepName === 'produce')?.output).toEqual({ greeting: 'hello' })
    expect(consumedInputs).toEqual([{ greeting: 'hello' }])
  })

  it('gives every copy the logger of the Payload instance another copy initialised', async () => {
    payload = await initFromFirstCopy()

    vi.resetModules()
    const { getLogger } = await import('../../src/plugin/logger.js')

    expect(() => getLogger()).not.toThrow()
  })

  it('lets one copy clear the hook trigger cache another copy filled', async () => {
    payload = await initFromFirstCopy()
    const find = vi.spyOn(payload, 'find')
    const triggerQueries = () => find.mock.calls.filter(([args]) => args.collection === 'automation-triggers').length

    const first = await import('../../src/plugin/trigger-cache.js')
    await first.getHookTriggers(payload, 60_000)
    expect(triggerQueries()).toBe(1)

    vi.resetModules()
    const second = await import('../../src/plugin/trigger-cache.js')
    await second.getHookTriggers(payload, 60_000)
    expect(triggerQueries()).toBe(1)

    second.clearHookTriggerCache(payload)
    await first.getHookTriggers(payload, 60_000)
    expect(triggerQueries()).toBe(2)
  })
})
