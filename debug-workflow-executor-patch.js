// Enhanced debugging patch for workflow executor
// This temporarily patches the workflow executor to add comprehensive logging

import { getPayload } from 'payload'

async function patchAndTestWorkflow() {
  const payload = await getPayload({ 
    config: (await import('./dev/payload.config.ts')).default 
  })

  console.log('🔧 === COMPREHENSIVE WORKFLOW DEBUGGING ===')

  // Step 1: Check workflow collection structure and versioning
  console.log('\n📋 Step 1: Analyzing workflow collection configuration...')
  
  const workflowCollection = payload.collections.workflows
  console.log('Workflow collection config:')
  console.log('  - Slug:', workflowCollection.config.slug)
  console.log('  - Versions enabled:', !!workflowCollection.config.versions)
  console.log('  - Drafts enabled:', !!workflowCollection.config.versions?.drafts)

  // Step 2: Test different query approaches for workflows
  console.log('\n🔍 Step 2: Testing workflow queries...')

  // Query 1: Default query (what the plugin currently uses)
  console.log('Query 1: Default query (no status filter)')
  try {
    const workflows1 = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100
    })
    console.log(`  - Found: ${workflows1.docs.length} workflows`)
    for (const wf of workflows1.docs) {
      console.log(`    - "${wf.name}" (ID: ${wf.id}) Status: ${wf._status || 'no-status'}`)
    }
  } catch (error) {
    console.log(`  - Error: ${error.message}`)
  }

  // Query 2: Only published workflows
  console.log('\nQuery 2: Only published workflows')
  try {
    const workflows2 = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100,
      where: {
        _status: {
          equals: 'published'
        }
      }
    })
    console.log(`  - Found: ${workflows2.docs.length} published workflows`)
    for (const wf of workflows2.docs) {
      console.log(`    - "${wf.name}" (ID: ${wf.id}) Status: ${wf._status}`)
      console.log(`      Triggers: ${JSON.stringify(wf.triggers, null, 2)}`)
    }
  } catch (error) {
    console.log(`  - Error: ${error.message}`)
  }

  // Query 3: All workflows with explicit status
  console.log('\nQuery 3: All workflows with status field')
  try {
    const workflows3 = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100,
      where: {
        _status: {
          exists: true
        }
      }
    })
    console.log(`  - Found: ${workflows3.docs.length} workflows with status`)
    for (const wf of workflows3.docs) {
      console.log(`    - "${wf.name}" Status: ${wf._status}`)
    }
  } catch (error) {
    console.log(`  - Error: ${error.message}`)
  }

  // Step 3: Create a test order and manually trigger the evaluation
  console.log('\n📦 Step 3: Creating test order...')

  const testOrder = await payload.create({
    collection: 'orders',
    data: {
      orderName: 'Debug Comprehensive Test - ' + Date.now(),
      status: 'Unpaid',
      customerEmail: 'debug@example.com',
      totalPrice: 1000,
      items: [{
        name: 'Debug Item',
        quantity: 1,
        price: 1000
      }]
    }
  })

  console.log(`Created order: ${testOrder.id} with status: ${testOrder.status}`)

  // Step 4: Test the WorkflowExecutor.executeTriggeredWorkflows method directly
  console.log('\n🎯 Step 4: Testing executeTriggeredWorkflows directly...')

  // Access the workflow executor (this might require accessing internal plugin state)
  // For now, let's simulate what should happen

  console.log('Simulating executeTriggeredWorkflows call...')
  console.log('  - Collection: orders')
  console.log('  - Operation: update') 
  console.log('  - Doc: { ...order, status: "Paid" }')
  console.log('  - PreviousDoc:', JSON.stringify(testOrder, null, 2))

  // Step 5: Update the order and capture all logs
  console.log('\n🔄 Step 5: Updating order with comprehensive logging...')

  // First, let's check what hooks are actually registered
  const orderCollection = payload.collections.orders
  console.log('Order collection hooks:')
  console.log('  - afterChange hooks:', orderCollection.config.hooks?.afterChange?.length || 0)

  // Count current workflow runs before
  const beforeRuns = await payload.find({ collection: 'workflow-runs' })
  console.log(`Current workflow runs: ${beforeRuns.docs.length}`)

  // Update the order
  console.log('\nUpdating order status to "Paid"...')
  const updatedOrder = await payload.update({
    collection: 'orders',
    id: testOrder.id,
    data: { status: 'Paid' }
  })

  console.log(`Order updated: ${updatedOrder.status}`)

  // Wait and check for workflow runs
  console.log('Waiting 5 seconds for async processing...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  const afterRuns = await payload.find({ collection: 'workflow-runs' })
  console.log(`Workflow runs after: ${afterRuns.docs.length}`)
  console.log(`New runs created: ${afterRuns.docs.length - beforeRuns.docs.length}`)

  if (afterRuns.docs.length > beforeRuns.docs.length) {
    console.log('✅ New workflow runs found!')
    const newRuns = afterRuns.docs.slice(0, afterRuns.docs.length - beforeRuns.docs.length)
    for (const run of newRuns) {
      console.log(`  - Run ${run.id}: ${run.status}`)
    }
  } else {
    console.log('❌ No new workflow runs created')
    
    // Additional debugging
    console.log('\n🕵️ Deep debugging - checking plugin state...')
    
    // Check if the plugin is actually loaded
    console.log('Available collections:', Object.keys(payload.collections))
    
    // Check for recent jobs
    const recentJobs = await payload.find({
      collection: 'payload-jobs',
      sort: '-createdAt',
      limit: 5
    })
    console.log(`Recent jobs: ${recentJobs.docs.length}`)
    for (const job of recentJobs.docs) {
      console.log(`  - ${job.taskSlug} (${job.processingError ? 'ERROR' : 'OK'})`)
    }
  }

  console.log('\n✨ Comprehensive debugging complete!')
  process.exit(0)
}

patchAndTestWorkflow().catch(console.error)