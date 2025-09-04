import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTestPayload, cleanDatabase } from './test-setup.js'

describe('Workflow Condition Fix Test', () => {

  beforeEach(async () => {
    await cleanDatabase()
  })

  afterEach(async () => {
    await cleanDatabase()
  })

  it('should correctly evaluate trigger conditions with $.trigger.doc path', async () => {
    const payload = getTestPayload()
    
    // Create a workflow with a condition using the correct JSONPath
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Condition Evaluation',
        description: 'Tests that $.trigger.doc.content conditions work',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create',
            condition: '$.trigger.doc.content == "TRIGGER_ME"'
          }
        ],
        steps: [
          {
            name: 'audit-step',
            step: 'create-document',
            collectionSlug: 'auditLog',
            data: {
              post: '$.trigger.doc.id',
              message: 'Condition was met and workflow triggered'
            }
          }
        ]
      }
    })

    console.log('Created workflow with condition: $.trigger.doc.content == "TRIGGER_ME"')

    // Create a post that SHOULD NOT trigger
    const post1 = await payload.create({
      collection: 'posts',
      data: {
        content: 'This should not trigger'
      }
    })

    // Create a post that SHOULD trigger
    const post2 = await payload.create({
      collection: 'posts',
      data: {
        content: 'TRIGGER_ME'
      }
    })

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Check workflow runs - should have exactly 1
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })

    console.log(`Found ${runs.totalDocs} workflow runs`)
    if (runs.totalDocs > 0) {
      console.log('Run statuses:', runs.docs.map(r => r.status))
    }

    // Should have exactly 1 run for the matching condition
    expect(runs.totalDocs).toBe(1)
    
    // Check audit logs - should only have one for post2
    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        post: {
          equals: post2.id
        }
      }
    })

    if (runs.docs[0].status === 'completed') {
      expect(auditLogs.totalDocs).toBe(1)
      expect(auditLogs.docs[0].message).toBe('Condition was met and workflow triggered')
    }

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
    
    console.log('✅ Condition evaluation working with $.trigger.doc path!')
  }, 30000)
})