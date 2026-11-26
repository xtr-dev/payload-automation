import fs from 'fs'
import os from 'os'
import path from 'path'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildTestConfig } from './build-test-config.js'
import { WorkflowExecutor } from '../../src/core/workflow-executor.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const removeDbFile = (dbFile: string) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${dbFile}${suffix}`
    if (fs.existsSync(file)) {
      fs.rmSync(file)
    }
  }
}

type Claim = (runId: number | string, req: PayloadRequest) => Promise<boolean>

/** The executor's private claim step, which switches a run from pending to running. */
const claimFor = (payload: Payload): Claim => {
  const executor = new WorkflowExecutor(payload, payload.logger) as unknown as { claimPendingRun: Claim }
  return (runId, req) => executor.claimPendingRun(runId, req)
}

const createRun = async (payload: Payload, status: string) => {
  const workflow = await payload.create({
    collection: 'workflows',
    data: { name: 'claim test', slug: `claim-${uniqueId()}` },
  })
  return payload.create({
    collection: 'workflow-runs',
    data: { workflow: workflow.id, status, startedAt: new Date().toISOString(), triggeredBy: 'test' },
  })
}

// Both adapters must decide "claimed" from the database's own conditional
// write, not from a status the caller read beforehand.
const claimContract = (getPayloadInstance: () => Payload) => {
  it('claims a pending run exactly once', async () => {
    const payload = getPayloadInstance()
    const run = await createRun(payload, 'pending')
    const claim = claimFor(payload)
    const req = await createLocalReq({}, payload)

    expect(await claim(run.id, req)).toBe(true)
    expect(await claim(run.id, req)).toBe(false)

    const stored = await payload.findByID({ collection: 'workflow-runs', id: run.id })
    expect(stored.status).toBe('running')
  })

  it('does not claim a run that is not pending', async () => {
    const payload = getPayloadInstance()
    const claim = claimFor(payload)
    const req = await createLocalReq({}, payload)
    for (const status of ['running', 'completed', 'failed']) {
      const run = await createRun(payload, status)
      expect(await claim(run.id, req)).toBe(false)
      expect((await payload.findByID({ collection: 'workflow-runs', id: run.id })).status).toBe(status)
    }
  })

  it('lets only one of several concurrent claims win', async () => {
    const payload = getPayloadInstance()
    const run = await createRun(payload, 'pending')
    const claim = claimFor(payload)
    const results = await Promise.all(
      Array.from({ length: 5 }, async () => claim(run.id, await createLocalReq({}, payload))),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })
}

describe('queued run claim on SQLite (raw conditional UPDATE ... RETURNING)', () => {
  const dbFile = path.join(os.tmpdir(), `payload-automation-claim-${uniqueId()}.db`)
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
  })

  afterAll(async () => {
    await payload.destroy()
    removeDbFile(dbFile)
  })

  claimContract(() => payload)
})

describe('queued run claim on MongoDB (findOneAndUpdate)', () => {
  let mongo: MongoMemoryReplSet
  let payload: Payload

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    payload = await getPayload({
      config: buildTestConfig({
        // Transactions off: a fresh in-memory server creates collections on
        // first write, which aborts multi-document transactions.
        db: mongooseAdapter({ transactionOptions: false, url: mongo.getUri('payload-automation-claim') }),
        dbFile: '',
      }),
      key: uniqueId(),
    })
  }, 240000)

  afterAll(async () => {
    await payload?.destroy()
    await mongo?.stop()
  })

  claimContract(() => payload)
})
