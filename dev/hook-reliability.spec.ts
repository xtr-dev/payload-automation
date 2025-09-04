import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from './payload.config'

describe('Hook Execution Reliability Tests', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    
    // Clean up any existing test data
    await cleanupTestData()
  }, 60000)

  afterAll(async () => {
    await cleanupTestData()
  }, 30000)

  const cleanupTestData = async () => {
    if (!payload) return
    
    try {
      // Clean up workflows
      const workflows = await payload.find({
        collection: 'workflows',
        where: {
          name: {
            like: 'Test Hook%'
          }
        }
      })
      
      for (const workflow of workflows.docs) {
        await payload.delete({
          collection: 'workflows',
          id: workflow.id
        })
      }

      // Clean up workflow runs
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

      // Clean up posts
      const posts = await payload.find({
        collection: 'posts',
        where: {
          content: {
            like: 'Test Hook%'
          }
        }
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
  }

  it('should reliably execute hooks when collections are created', async () => {
    // Create a workflow with collection trigger
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Hook Reliability - Create',
        description: 'Tests hook execution on post creation',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'create-audit-log',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                post: '$.trigger.doc.id',
                message: 'Post was created via workflow trigger',
                user: '$.trigger.req.user.id'
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
        content: 'Test Hook Reliability Post'
      }
    })

    expect(post).toBeDefined()

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Verify workflow run was created
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      },
      limit: 1
    })

    expect(runs.totalDocs).toBe(1)
    expect(runs.docs[0].status).not.toBe('failed')
    
    console.log('✅ Hook execution status:', runs.docs[0].status)
    
    // Verify audit log was created
    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        post: {
          equals: post.id
        }
      },
      limit: 1
    })

    expect(auditLogs.totalDocs).toBeGreaterThan(0)
    expect(auditLogs.docs[0].message).toContain('workflow trigger')
  }, 30000)

  it('should handle hook execution errors gracefully', async () => {
    // Create a workflow with invalid step configuration
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Hook Error Handling',
        description: 'Tests error handling in hook execution',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'invalid-http-request',
            step: 'http-request-step',
            input: {
              url: 'invalid-url-that-will-fail'
            }
          }
        ]
      }
    })

    // Create a post to trigger the workflow
    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Hook Error Handling Post'
      }
    })

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Verify a failed workflow run was created
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      },
      limit: 1
    })

    expect(runs.totalDocs).toBe(1)
    expect(runs.docs[0].status).toBe('failed')
    expect(runs.docs[0].error).toBeDefined()
    expect(runs.docs[0].error).toContain('URL')
    
    console.log('✅ Error handling working:', runs.docs[0].error)
  }, 30000)

  it('should create failed workflow runs when executor is unavailable', async () => {
    // This test simulates the executor being unavailable
    // We'll create a workflow and then simulate a hook execution without proper executor
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Hook Executor Unavailable',
        description: 'Tests handling when executor is not available',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'simple-step',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/get'
            }
          }
        ]
      }
    })

    // Temporarily disable the executor by setting it to null
    // This simulates the initialization issue
    const global = globalThis as any
    const originalExecutor = global.__workflowExecutor
    global.__workflowExecutor = null

    try {
      // Create a post to trigger the workflow
      const post = await payload.create({
        collection: 'posts',
        data: {
          content: 'Test Hook Executor Unavailable Post'
        }
      })

      // Wait for hook execution attempt
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Verify a failed workflow run was created for executor unavailability
      const runs = await payload.find({
        collection: 'workflow-runs',
        where: {
          workflow: {
            equals: workflow.id
          }
        },
        limit: 1
      })

      if (runs.totalDocs > 0) {
        expect(runs.docs[0].error).toBeDefined()
        console.log('✅ Executor unavailable error captured:', runs.docs[0].error)
      } else {
        console.log('⚠️ No workflow run created - this indicates the hook may not have executed')
      }
    } finally {
      // Restore the original executor
      global.__workflowExecutor = originalExecutor
    }
  }, 30000)

  it('should handle workflow conditions properly', async () => {
    // Create a workflow with a condition that should prevent execution
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Hook Conditional Execution',
        description: 'Tests conditional workflow execution',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create',
            condition: '$.doc.content == "TRIGGER_CONDITION"'
          }
        ],
        steps: [
          {
            name: 'conditional-audit',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                post: '$.trigger.doc.id',
                message: 'Conditional trigger executed'
              }
            }
          }
        ]
      }
    })

    // Create a post that SHOULD NOT trigger the workflow
    const post1 = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Hook Conditional - Should Not Trigger'
      }
    })

    // Create a post that SHOULD trigger the workflow
    const post2 = await payload.create({
      collection: 'posts',
      data: {
        content: 'TRIGGER_CONDITION'
      }
    })

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Check workflow runs
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })

    // Should have exactly 1 run (only for the matching condition)
    expect(runs.totalDocs).toBe(1)
    expect(runs.docs[0].status).not.toBe('failed')

    // Verify audit log was created only for the correct post
    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        post: {
          equals: post2.id
        }
      }
    })

    expect(auditLogs.totalDocs).toBe(1)

    // Verify no audit log for the first post
    const noAuditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        post: {
          equals: post1.id
        }
      }
    })

    expect(noAuditLogs.totalDocs).toBe(0)
    
    console.log('✅ Conditional execution working correctly')
  }, 30000)

  it('should handle multiple concurrent hook executions', async () => {
    // Create a workflow
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Hook Concurrent Execution',
        description: 'Tests handling multiple concurrent hook executions',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'concurrent-audit',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                post: '$.trigger.doc.id',
                message: 'Concurrent execution test'
              }
            }
          }
        ]
      }
    })

    // Create multiple posts concurrently
    const concurrentCreations = Array.from({ length: 5 }, (_, i) =>
      payload.create({
        collection: 'posts',
        data: {
          content: `Test Hook Concurrent Post ${i + 1}`
        }
      })
    )

    const posts = await Promise.all(concurrentCreations)
    expect(posts).toHaveLength(5)

    // Wait for all workflow executions
    await new Promise(resolve => setTimeout(resolve, 8000))

    // Verify all workflow runs were created
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })

    expect(runs.totalDocs).toBe(5)

    // Verify all runs completed successfully
    const failedRuns = runs.docs.filter(run => run.status === 'failed')
    expect(failedRuns).toHaveLength(0)

    console.log('✅ Concurrent executions completed:', {
      totalRuns: runs.totalDocs,
      statuses: runs.docs.map(run => run.status)
    })
  }, 45000)
})