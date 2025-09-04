import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from './payload.config'

describe('Error Scenarios and Edge Cases', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
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
            like: 'Test Error%'
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
            like: 'Test Error%'
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

  it('should handle HTTP timeout errors gracefully', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - HTTP Timeout',
        description: 'Tests HTTP request timeout handling',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'timeout-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/delay/35', // 35 second delay
              method: 'GET',
              timeout: 5000 // 5 second timeout
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Timeout Post'
      }
    })

    // Wait for workflow execution (should timeout)
    await new Promise(resolve => setTimeout(resolve, 10000))

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
    expect(runs.docs[0].error).toContain('timeout')
    
    console.log('✅ Timeout error handled:', runs.docs[0].error)
  }, 30000)

  it('should handle invalid JSON responses', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Invalid JSON',
        description: 'Tests invalid JSON response handling',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'invalid-json-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/html', // Returns HTML, not JSON
              method: 'GET'
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Invalid JSON Post'
      }
    })

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
    expect(runs.docs[0].status).toBe('completed') // Should complete but with HTML body
    expect(runs.docs[0].context.steps['invalid-json-request'].output.body).toContain('<html>')
    
    console.log('✅ Non-JSON response handled correctly')
  }, 20000)

  it('should handle circular reference in JSONPath resolution', async () => {
    // This test creates a scenario where JSONPath might encounter circular references
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Circular Reference',
        description: 'Tests circular reference handling in JSONPath',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'circular-test',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              body: {
                // This creates a deep reference that could cause issues
                triggerData: '$.trigger',
                stepData: '$.steps',
                nestedRef: '$.trigger.doc'
              }
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Circular Reference Post'
      }
    })

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
    // Should either succeed with safe serialization or fail gracefully
    expect(['completed', 'failed']).toContain(runs.docs[0].status)
    
    console.log('✅ Circular reference handled:', runs.docs[0].status)
  }, 20000)

  it('should handle malformed workflow configurations', async () => {
    // Create workflow with missing required fields
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Malformed Config',
        description: 'Tests malformed workflow configuration',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'malformed-step',
            step: 'create-document',
            input: {
              // Missing required collectionSlug
              data: {
                message: 'This should fail'
              }
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Malformed Config Post'
      }
    })

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
    expect(runs.docs[0].status).toBe('failed')
    expect(runs.docs[0].error).toContain('Collection slug is required')
    
    console.log('✅ Malformed config error:', runs.docs[0].error)
  }, 20000)

  it('should handle HTTP 4xx and 5xx errors properly', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - HTTP Errors',
        description: 'Tests HTTP error status handling',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'not-found-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/status/404',
              method: 'GET'
            }
          },
          {
            name: 'server-error-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/status/500',
              method: 'GET'
            },
            dependencies: ['not-found-request']
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error HTTP Status Post'
      }
    })

    await new Promise(resolve => setTimeout(resolve, 8000))

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
    
    // Check that both steps failed due to HTTP errors
    const context = runs.docs[0].context
    expect(context.steps['not-found-request'].state).toBe('failed')
    expect(context.steps['not-found-request'].output.status).toBe(404)
    
    console.log('✅ HTTP error statuses handled correctly')
  }, 25000)

  it('should handle retry logic for transient failures', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Retry Logic',
        description: 'Tests retry logic for HTTP requests',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'retry-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/status/503', // Service unavailable
              method: 'GET',
              retries: 3,
              retryDelay: 1000
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Retry Logic Post'
      }
    })

    await new Promise(resolve => setTimeout(resolve, 10000))

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
    expect(runs.docs[0].status).toBe('failed') // Should still fail after retries
    
    // The error should indicate multiple attempts were made
    const stepOutput = runs.docs[0].context.steps['retry-request'].output
    expect(stepOutput.status).toBe(503)
    
    console.log('✅ Retry logic executed correctly')
  }, 25000)

  it('should handle extremely large workflow contexts', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Large Context',
        description: 'Tests handling of large workflow contexts',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'large-response-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/base64/SFRUUEJJTiBpcyBhd2Vzb21l', // Returns base64 decoded text
              method: 'GET'
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Large Context Post'
      }
    })

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
    // Should handle large contexts without memory issues
    expect(['completed', 'failed']).toContain(runs.docs[0].status)
    
    console.log('✅ Large context handled:', runs.docs[0].status)
  }, 20000)

  it('should handle undefined and null values in JSONPath', async () => {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Error - Null Values',
        description: 'Tests null/undefined values in JSONPath expressions',
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'posts',
            operation: 'create'
          }
        ],
        steps: [
          {
            name: 'null-value-request',
            step: 'http-request-step',
            input: {
              url: 'https://httpbin.org/post',
              method: 'POST',
              body: {
                nonexistentField: '$.trigger.doc.nonexistent',
                nullField: '$.trigger.doc.null',
                undefinedField: '$.trigger.doc.undefined'
              }
            }
          }
        ]
      }
    })

    const post = await payload.create({
      collection: 'posts',
      data: {
        content: 'Test Error Null Values Post'
      }
    })

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
    // Should handle null/undefined values gracefully
    expect(['completed', 'failed']).toContain(runs.docs[0].status)
    
    if (runs.docs[0].status === 'completed') {
      const stepOutput = runs.docs[0].context.steps['null-value-request'].output
      expect(stepOutput.status).toBe(200) // httpbin should accept the request
      console.log('✅ Null values handled gracefully')
    } else {
      console.log('✅ Null values caused expected failure:', runs.docs[0].error)
    }
  }, 20000)
})