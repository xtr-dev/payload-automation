import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTestPayload, cleanDatabase } from './test-setup.js'
import { mockHttpBin, testFixtures } from './test-helpers.js'

describe('Workflow Trigger Test', () => {
  
  beforeEach(async () => {
    await cleanDatabase()
    // Set up HTTP mocks
    const expectedRequestData = {
      message: 'Post created',
      postId: expect.any(String), // MongoDB ObjectId
      postTitle: 'Test post content for workflow trigger'
    }
    mockHttpBin.mockPost(expectedRequestData)
  })

  afterEach(async () => {
    await cleanDatabase()
    mockHttpBin.cleanup()
  })

  it('should create a workflow run when a post is created', async () => {
    const payload = getTestPayload()
    
    // Use test fixtures for consistent data
    const testWorkflow = {
      ...testFixtures.basicWorkflow,
      name: 'Test Post Creation Workflow',
      description: 'Triggers when a post is created',
      steps: [
        {
          ...testFixtures.httpRequestStep(),
          name: 'log-post',
          body: {
            message: 'Post created',
            postId: '$.trigger.doc.id',
            postTitle: '$.trigger.doc.content'
          }
        }
      ]
    }
    
    // Create a workflow with collection trigger
    const workflow = await payload.create({
      collection: 'workflows',
      data: testWorkflow
    })

    expect(workflow).toBeDefined()
    expect(workflow.id).toBeDefined()

    // Create a post to trigger the workflow
    const post = await payload.create({
      collection: 'posts',
      data: testFixtures.testPost
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
    
    // Check if workflow is an object or ID
    const workflowRef = runs.docs[0].workflow
    const workflowId = typeof workflowRef === 'object' && workflowRef !== null 
      ? (workflowRef as any).id 
      : workflowRef
    
    expect(workflowId).toBe(workflow.id) // Should reference the workflow ID
    
    console.log('✅ Workflow run created successfully!')
    console.log(`Run status: ${runs.docs[0].status}`)
    console.log(`Run ID: ${runs.docs[0].id}`)
    
    if (runs.docs[0].status === 'failed' && runs.docs[0].error) {
      console.log(`Error: ${runs.docs[0].error}`)
    }
  }, 30000)
})