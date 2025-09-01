import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '../../payload.config'

export async function GET() {
  console.log('Starting workflow trigger test...')
  
  // Get payload instance
  const payload = await getPayload({ config })
  
  try {
    // Create a test user
    const user = await payload.create({
      collection: 'users',
      data: {
        email: `test-${Date.now()}@example.com`,
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
            taskSlug: 'http-request-step',
            input: JSON.stringify({
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
            })
          }
        ]
      },
      user: user.id
    })
    
    console.log('Created workflow:', workflow.id, workflow.name)
    console.log('Workflow triggers:', JSON.stringify(workflow.triggers, null, 2))
    
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
    await new Promise(resolve => setTimeout(resolve, 3000))
    
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
    
    const result = {
      success: runs.totalDocs > 0,
      workflowId: workflow.id,
      postId: post.id,
      runsFound: runs.totalDocs,
      runs: runs.docs.map(r => ({
        id: r.id,
        status: r.status,
        triggeredBy: r.triggeredBy,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        error: r.error
      }))
    }
    
    if (runs.totalDocs > 0) {
      console.log('✅ SUCCESS: Workflow was triggered!')
      console.log('Run status:', runs.docs[0].status)
      console.log('Run context:', JSON.stringify(runs.docs[0].context, null, 2))
    } else {
      console.log('❌ FAILURE: Workflow was not triggered')
    }
    
    return NextResponse.json(result)
    
  } catch (error) {
    console.error('Test failed:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}