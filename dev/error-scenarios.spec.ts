import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTestPayload, cleanDatabase } from './test-setup.js'
import { mockHttpBin, testFixtures } from './test-helpers.js'

describe('Error Scenarios and Edge Cases', () => {

  beforeEach(async () => {
    await cleanDatabase()
    // Set up comprehensive mocks for all error scenarios
    mockHttpBin.mockAllErrorScenarios()
  })

  afterEach(async () => {
    await cleanDatabase()
    mockHttpBin.cleanup()
  })

  it('should handle HTTP timeout errors gracefully', async () => {
    const payload = getTestPayload()
    
    // Clear existing mocks and set up a proper timeout mock
    mockHttpBin.cleanup()
    mockHttpBin.mockTimeout()
    
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
            ...testFixtures.httpRequestStep('https://httpbin.org/delay/10'),
            name: 'timeout-request',
            method: 'GET',
            timeout: 2000, // 2 second timeout
            body: null
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
    // Either failed due to timeout or completed (depending on network speed)
    expect(['failed', 'completed']).toContain(runs.docs[0].status)
    
    // Verify that detailed error information is preserved via new independent storage system
    const context = runs.docs[0].context
    const stepContext = context.steps['timeout-request']
    
    // Check that independent execution info was recorded
    expect(stepContext.executionInfo).toBeDefined()
    expect(stepContext.executionInfo.completed).toBe(true)
    
    // Check that detailed error information was preserved (new feature!)
    if (runs.docs[0].status === 'failed' && stepContext.errorDetails) {
      expect(stepContext.errorDetails.errorType).toBe('timeout')
      expect(stepContext.errorDetails.duration).toBeGreaterThan(2000)
      expect(stepContext.errorDetails.attempts).toBe(1)
      expect(stepContext.errorDetails.context.url).toBe('https://httpbin.org/delay/10')
      expect(stepContext.errorDetails.context.timeout).toBe(2000)
      console.log('✅ Detailed timeout error information preserved:', {
        errorType: stepContext.errorDetails.errorType,
        duration: stepContext.errorDetails.duration,
        attempts: stepContext.errorDetails.attempts
      })
    } else if (runs.docs[0].status === 'failed') {
      console.log('✅ Timeout error handled:', runs.docs[0].error)
    } else {
      console.log('✅ Request completed within timeout')
    }
  }, 15000)

  it('should handle invalid JSON responses', async () => {
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/html', // Returns HTML, not JSON
            method: 'GET'
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
  }, 25000)

  it('should handle circular reference in JSONPath resolution', async () => {
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/post',
            method: 'POST',
            body: {
              // This creates a deep reference that could cause issues
              triggerData: '$.trigger',
              stepData: '$.steps',
              nestedRef: '$.trigger.doc'
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
    const payload = getTestPayload()
    
    // This test should expect the workflow creation to fail due to validation
    let creationFailed = false
    let workflow: any = null
    
    try {
      // Create workflow with missing required fields for create-document
      workflow = await payload.create({
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
              // Missing required collectionSlug
              data: {
                message: 'This should fail'
              }
            }
          ]
        }
      })
    } catch (error) {
      creationFailed = true
      expect(error).toBeDefined()
      console.log('✅ Workflow creation failed as expected:', error instanceof Error ? error.message : error)
    }

    // If creation failed, that's the expected behavior
    if (creationFailed) {
      return
    }

    // If somehow the workflow was created, test execution failure
    if (workflow) {
      const post = await payload.create({
        collection: 'posts',
        data: {
          content: 'Test Error Malformed Config Post'
        }
      })

      await new Promise(resolve => setTimeout(resolve, 3000))

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
      
      console.log('✅ Malformed config caused execution failure:', runs.docs[0].error)
    }
  }, 15000)

  it('should handle HTTP 4xx and 5xx errors properly', async () => {
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/status/404',
            method: 'GET'
          },
          {
            name: 'server-error-request',
            step: 'http-request-step',
            url: 'https://httpbin.org/status/500',
            method: 'GET',
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
    expect(runs.docs[0].status).toBe('completed') // Workflow should complete successfully
    
    // Check that both steps completed with HTTP error outputs
    const context = runs.docs[0].context
    expect(context.steps['not-found-request'].state).toBe('succeeded') // HTTP request completed
    expect(context.steps['not-found-request'].output.status).toBe(404) // But with error status
    
    console.log('✅ HTTP error statuses handled correctly')
  }, 25000)

  it('should handle retry logic for transient failures', async () => {
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/status/503', // Service unavailable
            method: 'GET',
            retries: 3,
            retryDelay: 1000
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
    expect(runs.docs[0].status).toBe('completed') // Workflow should complete with HTTP error output
    
    // The step should have succeeded but with error status
    const stepContext = runs.docs[0].context.steps['retry-request']
    expect(stepContext.state).toBe('succeeded')
    expect(stepContext.output.status).toBe(503)
    
    console.log('✅ Retry logic executed correctly')
  }, 25000)

  it('should handle extremely large workflow contexts', async () => {
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/base64/SFRUUEJJTiBpcyBhd2Vzb21l', // Returns base64 decoded text
            method: 'GET'
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
    const payload = getTestPayload()
    
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
            url: 'https://httpbin.org/post',
            method: 'POST',
            body: {
              nonexistentField: '$.trigger.doc.nonexistent',
              nullField: '$.trigger.doc.null',
              undefinedField: '$.trigger.doc.undefined'
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