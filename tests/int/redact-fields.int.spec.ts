import fs from 'fs'
import os from 'os'
import path from 'path'
import { type Config, getPayload, type Payload, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

import { ReadDocumentStepTask } from '../../src/steps/index.js'
import { buildTestConfig, noopTask } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

// Values that must never show up where they are redacted. Each is unique, so
// a search through serialized data cannot match anything else.
const ACCESS_TOKEN = 'tok_access_4f1c9a'
const INTERNAL_NOTE = 'note_internal_77d2'
const PAYMENT_TOKEN = 'tok_payment_b03e'
const ITEM_SECRET_A = 'sec_item_a_91f0'
const ITEM_SECRET_B = 'sec_item_b_5c2d'
const ALL_SECRETS = [ACCESS_TOKEN, INTERNAL_NOTE, PAYMENT_TOKEN, ITEM_SECRET_A, ITEM_SECRET_B]

/**
 * Adds an `orders` collection whose document mixes ordinary fields with the
 * kinds of field a host wants kept out of run records: one nobody may read
 * (`access.read`), one hidden from every API (`hidden`), one inside a group
 * and one inside array rows.
 */
const withOrders: NonNullable<Config['plugins']>[number] = (config) => ({
  ...config,
  collections: [
    ...(config.collections ?? []),
    {
      slug: 'orders',
      fields: [
        { name: 'number', type: 'text' },
        { name: 'accessToken', type: 'text', access: { read: () => false } },
        { name: 'internalNote', type: 'text', hidden: true },
        {
          name: 'payment',
          type: 'group',
          fields: [
            { name: 'method', type: 'text' },
            { name: 'token', type: 'text' },
          ],
        },
        {
          name: 'items',
          type: 'array',
          fields: [
            { name: 'sku', type: 'text' },
            { name: 'secret', type: 'text' },
          ],
        },
      ],
    },
  ],
})

const orderData = {
  number: 'ORD-1',
  accessToken: ACCESS_TOKEN,
  internalNote: INTERNAL_NOTE,
  items: [
    { secret: ITEM_SECRET_A, sku: 'A' },
    { secret: ITEM_SECRET_B, sku: 'B' },
  ],
  payment: { method: 'card', token: PAYMENT_TOKEN },
}

// Inputs the capture step received at run time.
const capturedInputs: Array<Record<string, any>> = []
const captureTask: TaskConfig<string> = {
  slug: 'capture-step',
  label: 'Capture',
  handler: ({ input }) => {
    capturedInputs.push(input as Record<string, any>)
    return Promise.resolve({ output: { received: true }, state: 'succeeded' })
  },
}

const listedPaths: WorkflowsPluginConfig['redactFields'] = {
  collections: { orders: ['accessToken', 'internalNote', 'payment.token', 'items.secret'] },
}

type StoredRun = {
  context?: unknown
  inputs?: unknown
  status: string
  stepResults?: Array<{ input?: Record<string, any>; output?: Record<string, any>; status: string }>
  triggerData?: Record<string, any>
}

describe('redactFields', () => {
  let dbFile: string
  let payload: Payload

  const init = async (
    redactFields: WorkflowsPluginConfig['redactFields'],
    pluginOptions: Partial<WorkflowsPluginConfig> = {},
  ) => {
    dbFile = path.join(os.tmpdir(), `payload-automation-redact-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        dbFile,
        // Kept so that the input of a finished step job can be inspected.
        jobs: { deleteJobOnComplete: false, tasks: [] },
        pluginOptions: {
          collectionTriggers: { orders: true },
          redactFields,
          steps: [noopTask, captureTask, ReadDocumentStepTask],
          ...pluginOptions,
        },
        // The orders collection has to exist before the workflows plugin
        // registers its trigger hooks on it.
        prePlugins: [withOrders],
      }),
      key: uniqueId(),
    })
    capturedInputs.length = 0
  }

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  /** A workflow on orders afterChange with one step of `stepType` and input `config`. */
  const createOrdersWorkflow = async (
    config: Record<string, unknown>,
    options: { condition?: string; stepType?: string } = {},
  ) => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: {
        name: 'orders afterChange',
        type: 'collection-hook',
        collectionSlug: 'orders',
        condition: options.condition,
        hook: 'afterChange',
      },
    })
    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'capture', type: options.stepType ?? captureTask.slug, config },
    })
    await payload.create({
      collection: 'workflows',
      data: {
        name: 'on orders afterChange',
        slug: `on-orders-${uniqueId()}`,
        triggers: [trigger.id],
        steps: [{ step: step.id, slug: 'capture', stepName: 'capture' }],
      },
    })
  }

  const createOrder = () =>
    payload.create({ collection: 'orders', data: orderData, showHiddenFields: true }) as Promise<Record<string, any>>

  const findRuns = async (): Promise<StoredRun[]> => {
    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0, sort: 'createdAt' })
    return docs as unknown as StoredRun[]
  }

  /** Everything the plugin stored about its runs and their step jobs, as one string. */
  const storedText = async (): Promise<string> => {
    const runs = await payload.find({ collection: 'workflow-runs', depth: 0, pagination: false })
    const jobs = await payload.find({ collection: 'payload-jobs', depth: 0, pagination: false })
    return JSON.stringify([runs.docs, jobs.docs])
  }

  it('stores the whole triggering document when the option is not set', async () => {
    await init(undefined)
    await createOrdersWorkflow({})

    await createOrder()

    const [run] = await findRuns()
    expect(run.triggerData?.doc).toMatchObject({ accessToken: ACCESS_TOKEN, payment: { token: PAYMENT_TOKEN } })
  })

  it('leaves the listed fields out of the stored run and keeps the rest of the document', async () => {
    await init(listedPaths)
    await createOrdersWorkflow({})

    const order = await createOrder()

    const [run] = await findRuns()
    expect(run.status).toBe('completed')
    expect(run.triggerData?.doc).toMatchObject({
      number: 'ORD-1',
      items: [{ sku: 'A' }, { sku: 'B' }],
      payment: { method: 'card' },
    })
    const doc = run.triggerData?.doc as Record<string, any>
    expect(doc).not.toHaveProperty('accessToken')
    expect(doc).not.toHaveProperty('internalNote')
    expect(doc.payment).not.toHaveProperty('token')
    expect(doc.items[0]).not.toHaveProperty('secret')
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
    // The document the triggering operation returns is not touched.
    expect(order.accessToken).toBe(ACCESS_TOKEN)
    expect(order.payment.token).toBe(PAYMENT_TOKEN)
  })

  it('also cleans previousDoc when the document is updated', async () => {
    await init(listedPaths)
    const order = await createOrder()
    await createOrdersWorkflow({})

    await payload.update({ collection: 'orders', id: order.id, data: { number: 'ORD-2' } })

    const [run] = await findRuns()
    expect(run.triggerData?.doc.number).toBe('ORD-2')
    expect(run.triggerData?.previousDoc.number).toBe('ORD-1')
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
  })

  it('removes the fields from a document that a step input copies as a whole', async () => {
    await init(listedPaths)
    await createOrdersWorkflow({
      everything: '{{trigger}}',
      order: '{{trigger.doc}}',
      payment: '{{trigger.doc.payment}}',
    })

    await createOrder()

    expect(capturedInputs).toHaveLength(1)
    const [input] = capturedInputs
    expect(input.order.number).toBe('ORD-1')
    expect(input.order).not.toHaveProperty('accessToken')
    expect(input.payment).toEqual({ method: 'card' })
    expect(input.everything.doc.items).toEqual([
      expect.objectContaining({ sku: 'A' }),
      expect.objectContaining({ sku: 'B' }),
    ])
    expect(JSON.stringify(input)).not.toContain('tok_')
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
  })

  it('still lets an inline step and a condition read a redacted field that they name', async () => {
    await init(listedPaths)
    await createOrdersWorkflow(
      { token: '{{trigger.doc.accessToken}}' },
      // Only true when the condition can read the token.
      { condition: '$length(trigger.doc.payment.token) > 0' },
    )

    await createOrder()

    expect(capturedInputs).toEqual([{ token: ACCESS_TOKEN }])
    const [run] = await findRuns()
    // The named value is an ordinary step input and stored as one; the
    // document in the trigger data is still clean.
    expect(run.stepResults?.[0].input).toEqual({ token: ACCESS_TOKEN })
    expect(run.triggerData?.doc).not.toHaveProperty('accessToken')
    expect(JSON.stringify(run.triggerData)).not.toContain(PAYMENT_TOKEN)
  })

  it('with hideFromExpressions, hides the fields from conditions and step inputs too', async () => {
    await init({ ...listedPaths, hideFromExpressions: true })
    await createOrdersWorkflow({ number: '{{trigger.doc.number}}', token: '{{trigger.doc.accessToken}}' })
    await createOrdersWorkflow({}, { condition: '$length(trigger.doc.payment.token) > 0' })

    await createOrder()

    // Only the first workflow ran: the second one's condition could not see
    // the token it compares.
    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0].number).toBe('ORD-1')
    expect(capturedInputs[0].token).not.toBe(ACCESS_TOKEN)
    expect(await findRuns()).toHaveLength(1)
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
  })

  it('with hiddenFields, leaves out the fields the collection itself restricts', async () => {
    await init({ hiddenFields: true })
    await createOrdersWorkflow({ order: '{{trigger.doc}}' })

    await createOrder()

    const [run] = await findRuns()
    const doc = run.triggerData?.doc as Record<string, any>
    // `access.read` and `hidden: true` are restricted by the collection.
    expect(doc).not.toHaveProperty('accessToken')
    expect(doc).not.toHaveProperty('internalNote')
    // Fields without a restriction are stored unless they are listed.
    expect(doc.payment.token).toBe(PAYMENT_TOKEN)
    expect(capturedInputs[0].order).not.toHaveProperty('accessToken')
    const stored = await storedText()
    expect(stored).not.toContain(ACCESS_TOKEN)
    expect(stored).not.toContain(INTERNAL_NOTE)
  })

  it('in queue mode, gives steps the stored trigger data, without the redacted fields', async () => {
    await init(listedPaths, { execution: { mode: 'queue' } })
    await createOrdersWorkflow({ number: '{{trigger.doc.number}}', token: '{{trigger.doc.accessToken}}' })

    await createOrder()
    await payload.jobs.run()

    const [run] = await findRuns()
    expect(run.status).toBe('completed')
    expect(capturedInputs).toHaveLength(1)
    expect(capturedInputs[0].number).toBe('ORD-1')
    expect(capturedInputs[0].token).not.toBe(ACCESS_TOKEN)
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
  })

  it('removes the fields from the output of a document step on that collection', async () => {
    await init(listedPaths, { collectionTriggers: { posts: true } })
    const order = await createOrder()
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
    })
    const read = await payload.create({
      collection: 'automation-steps',
      data: { name: 'read', type: ReadDocumentStepTask.slug, config: { id: String(order.id), collectionSlug: 'orders' } },
    })
    const capture = await payload.create({
      collection: 'automation-steps',
      data: { name: 'capture', type: captureTask.slug, config: { order: '{{steps.read.output.doc}}' } },
    })
    await payload.create({
      collection: 'workflows',
      data: {
        name: 'read an order',
        slug: `read-order-${uniqueId()}`,
        triggers: [trigger.id],
        steps: [
          { step: read.id, slug: 'read', stepName: 'read' },
          { step: capture.id, slug: 'capture', stepName: 'capture', dependencies: [{ slug: 'read' }] },
        ],
      },
    })

    await payload.create({ collection: 'posts', data: {} })

    const [run] = await findRuns()
    expect(run.status).toBe('completed')
    expect(run.stepResults?.[0].output?.doc).toMatchObject({ number: 'ORD-1', payment: { method: 'card' } })
    expect(capturedInputs[0].order.number).toBe('ORD-1')
    const stored = await storedText()
    for (const secret of ALL_SECRETS) {
      expect(stored).not.toContain(secret)
    }
  })
})
