import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import nock from 'nock'
import config from './payload.config.js'

// Configure nock to intercept fetch requests properly in Node.js 22
nock.disableNetConnect()
nock.enableNetConnect('127.0.0.1')

// Set global fetch to use undici for proper nock interception
import { fetch } from 'undici'
global.fetch = fetch

let mongod: MongoMemoryReplSet | null = null
let payload: Payload | null = null

// Global test setup - runs once for all tests
beforeAll(async () => {
  // Start MongoDB in-memory replica set
  mongod = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      dbName: 'payload-test',
    },
  })

  const mongoUri = mongod.getUri()
  process.env.DATABASE_URI = mongoUri

  console.log('🚀 MongoDB in-memory server started:', mongoUri)
  
  // Initialize Payload with test config
  payload = await getPayload({
    config: await config,
    local: true
  })

  console.log('✅ Payload initialized for testing')
}, 60000)

// Global test teardown - runs once after all tests
afterAll(async () => {
  if (payload) {
    console.log('🛑 Shutting down Payload...')
    // Payload doesn't have a shutdown method, but we can clear the cache
    delete (global as any).payload
    payload = null
  }

  if (mongod) {
    console.log('🛑 Stopping MongoDB in-memory server...')
    await mongod.stop()
    mongod = null
  }
}, 30000)

// Export payload instance for tests
export const getTestPayload = () => {
  if (!payload) {
    throw new Error('Payload not initialized. Make sure test setup has run.')
  }
  return payload
}

// Helper to clean all collections
export const cleanDatabase = async () => {
  if (!payload) return
  
  try {
    // Clean up workflow runs first (child records)
    const runs = await payload.find({
      collection: 'workflow-runs',
      limit: 1000
    })
    
    for (const run of runs.docs) {
      await payload.delete({
        collection: 'workflow-runs',
        id: run.id
      })
    }

    // Clean up workflows
    const workflows = await payload.find({
      collection: 'workflows',
      limit: 1000
    })
    
    for (const workflow of workflows.docs) {
      await payload.delete({
        collection: 'workflows',
        id: workflow.id
      })
    }

    // Clean up audit logs
    const auditLogs = await payload.find({
      collection: 'auditLog',
      limit: 1000
    })
    
    for (const log of auditLogs.docs) {
      await payload.delete({
        collection: 'auditLog',
        id: log.id
      })
    }

    // Clean up posts
    const posts = await payload.find({
      collection: 'posts',
      limit: 1000
    })
    
    for (const post of posts.docs) {
      await payload.delete({
        collection: 'posts',
        id: post.id
      })
    }
  } catch (error) {
    console.warn('Database cleanup failed:', error)
  }
}