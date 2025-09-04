import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from './payload.config'

describe('Webhook Trigger Testing', () => {
  let payload: Payload
  let baseUrl: string

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    baseUrl = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'
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
            like: 'Test Webhook%'
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

      // Clean up audit logs
      const auditLogs = await payload.find({
        collection: 'auditLog',
        where: {
          message: {
            like: 'Webhook%'
          }
        }
      })
      
      for (const log of auditLogs.docs) {
        await payload.delete({
          collection: 'auditLog',
          id: log.id
        })
      }
    } catch (error) {
      console.warn('Cleanup failed:', error)
    }
  }

  const makeWebhookRequest = async (path: string, data: any = {}, method: string = 'POST') => {
    const webhookUrl = `${baseUrl}/api/workflows/webhook/${path}`
    
    console.log(`Making webhook request to: ${webhookUrl}`)
    
    const response = await fetch(webhookUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    })

    return {
      status: response.status,
      statusText: response.statusText,
      data: response.ok ? await response.json().catch(() => ({})) : null,
      text: await response.text().catch(() => '')
    }
  }

  it('should trigger workflow via webhook endpoint', async () => {
    // Create a workflow with webhook trigger
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Basic Trigger',
        description: 'Tests basic webhook triggering',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-basic'
          }
        ],
        steps: [
          {
            name: 'create-webhook-audit',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                message: 'Webhook triggered successfully',
                user: '$.trigger.data.userId'
              }
            }
          }
        ]
      }
    })

    expect(workflow).toBeDefined()

    // Make webhook request
    const response = await makeWebhookRequest('test-basic', {
      userId: 'webhook-test-user',
      timestamp: new Date().toISOString()
    })

    expect(response.status).toBe(200)
    console.log('✅ Webhook response:', response.status, response.statusText)

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

    // Verify audit log was created
    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        message: {
          contains: 'Webhook triggered'
        }
      },
      limit: 1
    })

    expect(auditLogs.totalDocs).toBe(1)
    console.log('✅ Webhook audit log created')
  }, 30000)

  it('should handle webhook with complex data', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Complex Data',
        description: 'Tests webhook with complex JSON data',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-complex'
          }
        ],
        steps: [
          {
            name: 'echo-webhook-data',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              body: {
                originalData: '$.trigger.data',
                headers: '$.trigger.headers',
                path: '$.trigger.path'
              }
            }
          }
        ]
      }
    })

    const complexData = {
      user: {
        id: 123,
        name: 'Test User',
        permissions: ['read', 'write']
      },
      event: {
        type: 'user_action',
        timestamp: new Date().toISOString(),
        metadata: {
          source: 'webhook-test',
          version: '1.0.0'
        }
      },
      nested: {
        deeply: {
          nested: {
            value: 'deep-test-value'
          }
        }
      }
    }

    const response = await makeWebhookRequest('test-complex', complexData)
    expect(response.status).toBe(200)

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

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
    expect(runs.docs[0].status).toBe('completed')

    // Verify the complex data was properly passed through
    const stepOutput = runs.docs[0].context.steps['echo-webhook-data'].output
    expect(stepOutput.status).toBe(200)
    
    const responseBody = JSON.parse(stepOutput.body)
    expect(responseBody.json.originalData.user.name).toBe('Test User')
    expect(responseBody.json.originalData.nested.deeply.nested.value).toBe('deep-test-value')

    console.log('✅ Complex webhook data processed correctly')
  }, 30000)

  it('should handle webhook conditions', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Conditional',
        description: 'Tests conditional webhook execution',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-conditional',
            condition: '$.data.action == "important"'
          }
        ],
        steps: [
          {
            name: 'conditional-audit',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                message: 'Webhook condition met - important action'
              }
            }
          }
        ]
      }
    })

    // First request - should NOT trigger (condition not met)
    const response1 = await makeWebhookRequest('test-conditional', {
      action: 'normal',
      data: 'test'
    })
    expect(response1.status).toBe(200)

    // Second request - SHOULD trigger (condition met)
    const response2 = await makeWebhookRequest('test-conditional', {
      action: 'important',
      priority: 'high'
    })
    expect(response2.status).toBe(200)

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

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

    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        message: {
          contains: 'condition met'
        }
      }
    })

    expect(auditLogs.totalDocs).toBe(1)
    console.log('✅ Webhook conditional execution working')
  }, 30000)

  it('should handle webhook authentication headers', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Headers',
        description: 'Tests webhook header processing',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-headers'
          }
        ],
        steps: [
          {
            name: 'process-headers',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              body: {
                receivedHeaders: '$.trigger.headers',
                authorization: '$.trigger.headers.authorization',
                userAgent: '$.trigger.headers.user-agent'
              }
            }
          }
        ]
      }
    })

    // Make webhook request with custom headers
    const webhookUrl = `${baseUrl}/api/workflows/webhook/test-headers`
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token-123',
        'User-Agent': 'Webhook-Test-Client/1.0',
        'X-Custom-Header': 'custom-value'
      },
      body: JSON.stringify({
        test: 'header processing'
      })
    })

    expect(response.status).toBe(200)

    // Wait for workflow execution
    await new Promise(resolve => setTimeout(resolve, 5000))

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
    expect(runs.docs[0].status).toBe('completed')

    // Verify headers were captured and processed
    const stepOutput = runs.docs[0].context.steps['process-headers'].output
    const responseBody = JSON.parse(stepOutput.body)
    
    expect(responseBody.json.authorization).toBe('Bearer test-token-123')
    expect(responseBody.json.userAgent).toBe('Webhook-Test-Client/1.0')

    console.log('✅ Webhook headers processed correctly')
  }, 30000)

  it('should handle multiple concurrent webhook requests', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Concurrent',
        description: 'Tests concurrent webhook processing',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-concurrent'
          }
        ],
        steps: [
          {
            name: 'concurrent-audit',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                message: 'Concurrent webhook execution',
                requestId: '$.trigger.data.requestId'
              }
            }
          }
        ]
      }
    })

    // Make multiple concurrent webhook requests
    const concurrentRequests = Array.from({ length: 5 }, (_, i) =>
      makeWebhookRequest('test-concurrent', {
        requestId: `concurrent-${i + 1}`,
        timestamp: new Date().toISOString()
      })
    )

    const responses = await Promise.all(concurrentRequests)
    responses.forEach(response => {
      expect(response.status).toBe(200)
    })

    // Wait for all workflow executions
    await new Promise(resolve => setTimeout(resolve, 8000))

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

    // Verify all audit logs were created
    const auditLogs = await payload.find({
      collection: 'auditLog',
      where: {
        message: {
          contains: 'Concurrent webhook'
        }
      }
    })

    expect(auditLogs.totalDocs).toBe(5)
    console.log('✅ Concurrent webhook requests processed successfully')
  }, 35000)

  it('should handle non-existent webhook paths gracefully', async () => {
    const response = await makeWebhookRequest('non-existent-path', {
      test: 'should fail'
    })

    // Should return 404 or appropriate error status
    expect([404, 400]).toContain(response.status)
    console.log('✅ Non-existent webhook path handled:', response.status)
  }, 10000)

  it('should handle malformed webhook JSON', async () => {
    const webhookUrl = `${baseUrl}/api/workflows/webhook/test-malformed`
    
    // First create a workflow to receive the malformed request
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Webhook - Malformed JSON',
        description: 'Tests malformed JSON handling',
        triggers: [
          {
            type: 'webhook-trigger',
            webhookPath: 'test-malformed'
          }
        ],
        steps: [
          {
            name: 'malformed-test',
            step: 'create-document',
            input: {
              collectionSlug: 'auditLog',
              data: {
                message: 'Processed malformed request'
              }
            }
          }
        ]
      }
    })

    // Send malformed JSON
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"malformed": json, "missing": quotes}'
    })

    // Should handle malformed JSON gracefully
    expect([400, 422]).toContain(response.status)
    console.log('✅ Malformed JSON handled:', response.status)
  }, 15000)
})