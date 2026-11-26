import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildTestConfig, noopTask } from './build-test-config.js'
import { triggerCustomWorkflow, triggerWorkflowById } from '../../src/core/trigger-custom-workflow.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

const failingTask: TaskConfig<string> = {
  slug: 'failing-step',
  label: 'Failing',
  handler: () => Promise.resolve({ errorMessage: 'step exploded', state: 'failed' }),
}

/** Creates a workflow with one manual trigger and one step of `stepType`. */
const createManualWorkflow = async (
  payload: Payload,
  { enabled = true, stepType = noopTask.slug }: { enabled?: boolean; stepType?: string } = {},
): Promise<string> => {
  const trigger = await payload.create({
    collection: 'automation-triggers',
    data: { name: 'manual', type: 'manual' },
  })
  const step = await payload.create({
    collection: 'automation-steps',
    data: { name: 'only', type: stepType },
  })
  const workflow = await payload.create({
    collection: 'workflows',
    data: {
      name: 'manual workflow',
      slug: `manual-${uniqueId()}`,
      enabled,
      triggers: [trigger.id],
      steps: [{ step: step.id, slug: 'only', stepName: 'only', errorHandling: 'stop' }],
    },
  })
  return String(workflow.id)
}

const allRuns = async (payload: Payload) =>
  (await payload.find({ collection: 'workflow-runs', depth: 0 })).docs as unknown as Array<{
    firedTrigger?: unknown
    id: number | string
    status: string
  }>

describe('triggerWorkflowById', () => {
  let dbFile: string
  let payload: Payload

  beforeEach(async () => {
    dbFile = path.join(os.tmpdir(), `payload-automation-trigger-by-id-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({ dbFile, pluginOptions: { steps: [noopTask, failingTask] } }),
      key: uniqueId(),
    })
  })

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  it('returns the run id of a successful run and records the fired trigger', async () => {
    const workflowId = await createManualWorkflow(payload)

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    const runs = await allRuns(payload)
    expect(runs).toHaveLength(1)
    expect(result).toMatchObject({ runId: String(runs[0].id), status: 'triggered', workflowId })
    expect(runs[0].status).toBe('completed')
    expect(runs[0].firedTrigger).toBeTruthy()
  })

  it('resolves with status failed and the failed run id when a step fails', async () => {
    const workflowId = await createManualWorkflow(payload, { stepType: failingTask.slug })

    const result = await triggerWorkflowById(payload, workflowId, 'manual')

    const runs = await allRuns(payload)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('failed')
    expect(result.status).toBe('failed')
    expect(result.runId).toBe(String(runs[0].id))
    expect(result.error).toContain('step exploded')
    expect(result.workflowName).toBe('manual workflow')
  })

  it('refuses a disabled workflow without creating a run', async () => {
    const workflowId = await createManualWorkflow(payload, { enabled: false })

    await expect(triggerWorkflowById(payload, workflowId, 'manual')).rejects.toThrow(/disabled/)
    expect(await allRuns(payload)).toHaveLength(0)
  })

  it('still throws when the workflow has no trigger of that type', async () => {
    const workflowId = await createManualWorkflow(payload)

    await expect(triggerWorkflowById(payload, workflowId, 'webhook')).rejects.toThrow(/does not have trigger/)
    expect(await allRuns(payload)).toHaveLength(0)
  })
})

describe('triggerCustomWorkflow', () => {
  let dbFile: string
  let payload: Payload

  beforeEach(async () => {
    dbFile = path.join(os.tmpdir(), `payload-automation-trigger-custom-${uniqueId()}.db`)
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
  })

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  it('skips disabled workflows', async () => {
    const enabledId = await createManualWorkflow(payload)
    await createManualWorkflow(payload, { enabled: false })

    const results = await triggerCustomWorkflow(payload, { slug: 'manual' })

    expect(results.map((r) => r.workflowId)).toEqual([enabledId])
    expect(await allRuns(payload)).toHaveLength(1)
  })
})
