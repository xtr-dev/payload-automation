import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload, type Payload, type TaskConfig } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { triggerWorkflowById } from '../../src/core/trigger-custom-workflow.js'
import { ReadDocumentStepTask } from '../../src/steps/read-document.js'
import { buildTestConfig } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

// What a later step sees of the read step's output, resolved from expressions.
const consumedInputs: Array<Record<string, unknown>> = []
const consumeTask: TaskConfig<string> = {
  slug: 'consume-step',
  label: 'Consume',
  handler: ({ input }) => {
    consumedInputs.push(input as Record<string, unknown>)
    return Promise.resolve({ output: {}, state: 'succeeded' })
  },
}

describe('read-document step output', () => {
  const dbFile = path.join(os.tmpdir(), `payload-automation-read-document-${uniqueId()}.db`)
  let payload: Payload
  let postIds: Array<number | string>

  beforeAll(async () => {
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        pluginOptions: { steps: [ReadDocumentStepTask as unknown as TaskConfig<string>, consumeTask] },
      }),
      key: uniqueId(),
    })
    postIds = []
    for (let i = 0; i < 3; i++) {
      postIds.push((await payload.create({ collection: 'posts', data: {} })).id)
    }
  })

  afterAll(async () => {
    await payload.destroy()
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${dbFile}${suffix}`, { force: true })
    }
  })

  beforeEach(() => {
    consumedInputs.length = 0
  })

  /**
   * Runs a manual workflow with a read-document step configured with
   * `readInput`, followed by a step that receives the read step's `doc`,
   * `docs` and `totalDocs` through expressions, and returns what it received.
   */
  const readThroughWorkflow = async (readInput: Record<string, unknown>) => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'manual', type: 'manual' },
    })
    const read = await payload.create({
      collection: 'automation-steps',
      data: { name: 'read', type: 'read-document', config: { collectionSlug: 'posts', ...readInput } },
    })
    const consume = await payload.create({
      collection: 'automation-steps',
      data: {
        name: 'consume',
        type: consumeTask.slug,
        config: {
          doc: '{{steps.read.output.doc}}',
          docs: '{{steps.read.output.docs}}',
          firstId: '{{steps.read.output.docs[0].id}}',
          totalDocs: '{{steps.read.output.totalDocs}}',
        },
      },
    })
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'read then consume',
        slug: `read-consume-${uniqueId()}`,
        triggers: [trigger.id],
        steps: [
          { step: read.id, slug: 'read', stepName: 'read' },
          { step: consume.id, slug: 'consume', stepName: 'consume', dependencies: [{ slug: 'read' }] },
        ],
      },
    })

    const result = await triggerWorkflowById(payload, String(workflow.id), 'manual')
    expect(result.status).toBe('triggered')
    expect(consumedInputs).toHaveLength(1)
    return consumedInputs[0] as { doc: any; docs: any; firstId: unknown; totalDocs: unknown }
  }

  it('returns the matches of a query as a list under docs, and the first match under doc', async () => {
    const output = await readThroughWorkflow({ limit: 2, sort: 'id' })

    expect(Array.isArray(output.docs)).toBe(true)
    expect(output.docs.map((doc: any) => doc.id)).toEqual(postIds.slice(0, 2))
    expect(output.firstId).toBe(postIds[0])
    // totalDocs counts every match, not just the ones within the limit.
    expect(output.totalDocs).toBe(3)
    // doc is a single document, not the list.
    expect(Array.isArray(output.doc)).toBe(false)
    expect(output.doc.id).toBe(postIds[0])
  })

  it('returns an empty list and a null doc when the query matches nothing', async () => {
    const output = await readThroughWorkflow({ where: { id: { equals: 999999 } } })

    expect(output.docs).toEqual([])
    expect(output.doc ?? null).toBeNull()
    expect(output.totalDocs).toBe(0)
  })

  it('returns the document read by id under doc, and as a one-item list under docs', async () => {
    const output = await readThroughWorkflow({ id: String(postIds[1]) })

    expect(output.doc.id).toBe(postIds[1])
    expect(output.docs.map((doc: any) => doc.id)).toEqual([postIds[1]])
    expect(output.totalDocs).toBe(1)
  })
})
