import { sqliteAdapter } from '@payloadcms/db-sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { type Config, getPayload, type Payload, type PayloadRequest, type TaskConfig } from 'payload'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

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

// What the step found when it looked up the triggering post in a transaction
// of its own: `true` when the post was visible, i.e. already committed.
const postVisibleToStep: boolean[] = []
const lookupTask: TaskConfig<string> = {
  slug: 'lookup-post-step',
  label: 'Look up post',
  handler: async ({ input, req }) => {
    const { docs } = await req.payload.find({
      collection: 'posts',
      depth: 0,
      where: { id: { equals: (input as { postId: number | string }).postId } },
    })
    postVisibleToStep.push(docs.length === 1)
    return { output: { found: docs.length }, state: 'succeeded' }
  },
}

/**
 * Adds an afterChange hook to `posts` that fails the operation when the
 * request context says so. It is appended after the automation hook, so the
 * workflow has already been triggered when the operation fails.
 */
const failingPostHook: NonNullable<Config['plugins']>[number] = (config) => ({
  ...config,
  collections: (config.collections ?? []).map((collection) =>
    collection.slug === 'posts'
      ? {
          ...collection,
          hooks: {
            ...collection.hooks,
            afterChange: [
              ...(collection.hooks?.afterChange ?? []),
              ({ doc, req }) => {
                if (req.context.failAfterChange) {
                  throw new Error('host hook rejected the post')
                }
                return doc
              },
            ],
          },
        }
      : collection,
  ),
})

// These tests need hooks to run inside a database transaction. Postgres always
// uses one and MongoDB does on a replica set, so with TEST_DATABASE set the
// configured server is used as it is. SQLite only uses transactions when the
// adapter gets `transactionOptions`, so the default run switches them on.
const transactionalDb = (dbFile: string) =>
  process.env.TEST_DATABASE && process.env.TEST_DATABASE !== 'sqlite'
    ? undefined
    : sqliteAdapter({ client: { url: `file:${dbFile}` }, transactionOptions: {} })

// A MongoDB server without a replica set has no transactions; hooks then run
// as they always did and there is nothing to defer.
const hasTransactions = !(process.env.TEST_DATABASE === 'mongodb' && process.env.TEST_MONGODB_TRANSACTIONS === 'false')

describe.runIf(hasTransactions)('workflows triggered from a hook inside a database transaction', () => {
  let dbFile: string
  let payload: Payload

  const init = async (pluginOptions: Partial<WorkflowsPluginConfig> = {}) => {
    dbFile = path.join(os.tmpdir(), `payload-automation-after-commit-${uniqueId()}.db`)
    payload = await getPayload({
      config: buildTestConfig({
        db: transactionalDb(dbFile),
        dbFile,
        extraPlugins: [failingPostHook],
        pluginOptions: { steps: [noopTask, lookupTask], ...pluginOptions },
      }),
      key: uniqueId(),
    })
    postVisibleToStep.length = 0

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts afterChange', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChange' },
    })
    const step = await payload.create({
      collection: 'automation-steps',
      data: { name: 'lookup', type: lookupTask.slug, config: { postId: '{{trigger.doc.id}}' } },
    })
    await payload.create({
      collection: 'workflows',
      data: {
        name: 'look up the changed post',
        slug: `lookup-${uniqueId()}`,
        triggers: [trigger.id],
        steps: [{ step: step.id, slug: 'lookup', stepName: 'lookup' }],
      },
    })
  }

  const findRuns = async () => {
    const { docs } = await payload.find({ collection: 'workflow-runs', depth: 0 })
    return docs as unknown as Array<{ error?: null | string; status: string; stepResults?: Array<{ status: string }> }>
  }

  afterEach(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  it('runs the steps once the triggering operation has committed, before that operation returns', async () => {
    await init()

    await payload.create({ collection: 'posts', data: {} })

    const runs = await findRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].error ?? null).toBeNull()
    expect(runs[0].status).toBe('completed')
    expect(runs[0].stepResults).toMatchObject([{ status: 'succeeded' }])
    // The step read the post through a connection of its own, so it only
    // finds it when the triggering transaction was committed first.
    expect(postVisibleToStep).toEqual([true])
  })

  it('starts no workflow and stores no run when the triggering operation is rolled back', async () => {
    await init()

    await expect(
      payload.create({ collection: 'posts', context: { failAfterChange: true }, data: {} })
    ).rejects.toThrow('host hook rejected the post')

    expect(postVisibleToStep).toEqual([])
    expect(await findRuns()).toHaveLength(0)
    expect((await payload.find({ collection: 'posts' })).docs).toHaveLength(0)

    // The dropped workflow does not come back with a later transaction.
    await payload.create({ collection: 'posts', data: {} })
    expect(postVisibleToStep).toEqual([true])
    expect(await findRuns()).toHaveLength(1)
  })

  it('waits for the commit of a transaction the caller owns', async () => {
    await init()
    const transactionID = await payload.db.beginTransaction()
    expect(transactionID).toBeTruthy()
    const req = { transactionID: transactionID! } as Partial<PayloadRequest>

    await payload.create({ collection: 'posts', data: {}, req })
    await payload.create({ collection: 'posts', data: {}, req })

    // Both operations have returned, but nothing is committed yet.
    expect(postVisibleToStep).toEqual([])

    await payload.db.commitTransaction(transactionID!)

    expect(postVisibleToStep).toEqual([true, true])
    const runs = await findRuns()
    expect(runs.map((run) => run.status)).toEqual(['completed', 'completed'])
  })

  it('starts nothing when a transaction the caller owns is rolled back', async () => {
    await init()
    const transactionID = await payload.db.beginTransaction()
    const req = { transactionID: transactionID! } as Partial<PayloadRequest>

    await payload.create({ collection: 'posts', data: {}, req })
    await payload.db.rollbackTransaction(transactionID!)

    expect(postVisibleToStep).toEqual([])
    expect(await findRuns()).toHaveLength(0)
    expect((await payload.find({ collection: 'posts' })).docs).toHaveLength(0)
  })

  it('in queue mode, rolls the pending run back together with the triggering operation', async () => {
    await init({ execution: { mode: 'queue' } })

    await expect(
      payload.create({ collection: 'posts', context: { failAfterChange: true }, data: {} })
    ).rejects.toThrow('host hook rejected the post')
    expect(await findRuns()).toHaveLength(0)

    await payload.create({ collection: 'posts', data: {} })
    expect((await findRuns()).map((run) => run.status)).toEqual(['pending'])
    await payload.jobs.run()
    expect((await findRuns()).map((run) => run.status)).toEqual(['completed'])
    expect(postVisibleToStep).toEqual([true])
  })
})
