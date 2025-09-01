import type { Payload } from 'payload'
import { getPayload } from 'payload'
import config from './payload.config'

async function testWorkflowTrigger() {
  console.log('Starting workflow trigger test...')
  
  // Get payload instance
  const payload = await getPayload({ config })
  
  try {
    // Create a test user
    const user = await payload.create({
      collection: 'users',
      data: {
        email: 'test@example.com',
        password: 'password123'
      }
    })
    
    console.log('Created test user:', user.id)
    
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
                postTitle: '$.trigger.doc.title'
              }
            }
          }
        ]
      },
      user: user.id
    })
    
    console.log('Created workflow:', workflow.id)
    
    // Create a post to trigger the workflow
    console.log('Creating post to trigger workflow...')
    const post = await payload.create({
      collection: 'posts',
      data: {
        title: 'Test Post',
        content: 'This should trigger the workflow',
        _status: 'published'
      },
      user: user.id
    })
    
    console.log('Created post:', post.id)
    
    // Wait a bit for workflow to execute
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Check for workflow runs
    const runs = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })
    
    console.log('Workflow runs found:', runs.totalDocs)
    
    if (runs.totalDocs > 0) {
      console.log('✅ SUCCESS: Workflow was triggered!')
      console.log('Run status:', runs.docs[0].status)
      console.log('Run context:', JSON.stringify(runs.docs[0].context, null, 2))
    } else {
      console.log('❌ FAILURE: Workflow was not triggered')
    }
    
  } catch (error) {
    console.error('Test failed:', error)
  } finally {
    await payload.shutdown()
  }
}

testWorkflowTrigger().catch(console.error)