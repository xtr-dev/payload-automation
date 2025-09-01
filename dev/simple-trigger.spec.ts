import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from './payload.config'

describe('Workflow Trigger Test', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  }, 60000)

  afterAll(async () => {
    if (!payload) return
    
    try {
      // Clear test data
      const workflows = await payload.find({
        collection: 'workflows',
        limit: 100
      })
      
      for (const workflow of workflows.docs) {
        await payload.delete({
          collection: 'workflows',
          id: workflow.id
        })
      }

      const runs = await payload.find({
        collection: 'workflow-runs',
        limit: 100
      })
      
      for (const run of runs.docs) {
        await payload.delete({
          collection: 'workflow-runs',
          id: run.id
        })
      }

      const posts = await payload.find({
        collection: 'posts',
        limit: 100
      })
      
      for (const post of posts.docs) {
        await payload.delete({
          collection: 'posts',
          id: post.id
        })
      }
    } catch (error) {
      console.warn('Cleanup failed:', error)
    }
  }, 30000)

  it('should create a workflow run when a post is created', async () => {
    // Create a workflow with collection trigger
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Post Creation Workflow',
        description: 'Triggers when a post is created',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'log-post',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                message: 'Post created',
                postId: '$.trigger.doc.id',
                postTitle: '$.trigger.doc.content'
              }
            }
          }
        ]
      }
    })

    expect(workflow).toBeDefined()
    expect(workflow.id).toBeDefined()

    // Create a post to trigger the workflow
    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'This should trigger the workflow'
      }
    })

    expect(post).toBeDefined()
    expect(post.id).toBeDefined()

    // Wait a bit for workflow to execute
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Check for workflow runs
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      },
      limit: 10
    })

    expect(runs.totalDocs).toBeGreaterThan(0)
    expect(runs.docs[0].workflow).toBe(typeof workflow.id === 'object' ? workflow.id.toString() : workflow.id)
    
    console.log('✅ Workflow run created successfully!')
    console.log(`Run status: ${runs.docs[0].status}`)
    console.log(`Run ID: ${runs.docs[0].id}`)
    
    if (runs.docs[0].status === 'failed' && runs.docs[0].error) {
      console.log(`Error: ${runs.docs[0].error}`)
    }
  }, 30000)
})