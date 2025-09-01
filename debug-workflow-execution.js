// Enhanced debugging script for workflow execution issues
const { getPayload } = require('payload')
const { JSONPath } = require('jsonpath-plus')

async function debugWorkflowExecution() {
  const payload = await getPayload({ 
    config: require('./dev/payload.config.ts').default 
  })

  console.log('🔍 === WORKFLOW EXECUTION DEBUGGING ===')

  // Step 1: Verify workflow exists and has correct structure
  console.log('\n📋 Step 1: Finding workflows...')
  const workflows = await payload.find({
    collection: 'workflows',
    depth: 2,
    limit: 100
  })

  console.log(`Found ${workflows.docs.length} workflows:`)
  
  for (const workflow of workflows.docs) {
    console.log(`\n  Workflow: "${workflow.name}" (ID: ${workflow.id})`)
    console.log(`  Enabled: ${workflow.enabled !== false}`)
    console.log(`  Triggers: ${JSON.stringify(workflow.triggers, null, 4)}`)
    console.log(`  Steps: ${JSON.stringify(workflow.steps, null, 4)}`)
  }

  // Step 2: Create test order and simulate the trigger context
  console.log('\n📦 Step 2: Creating test order...')
  
  const testOrder = await payload.create({
    collection: 'orders',
    data: {
      orderName: 'Debug Test Order - ' + Date.now(),
      status: 'Unpaid',
      customerEmail: 'debug@example.com',
      totalPrice: 1500,
      items: [
        {
          name: 'Debug Item',
          quantity: 1,
          price: 1500
        }
      ]
    }
  })

  console.log(`Created test order: ${testOrder.id} with status: "${testOrder.status}"`)

  // Step 3: Test JSONPath condition evaluation directly
  console.log('\n🧪 Step 3: Testing JSONPath condition evaluation...')

  // Simulate the execution context that would be created during hook execution
  const simulatedContext = {
    steps: {},
    trigger: {
      type: 'collection',
      collection: 'orders',
      doc: { ...testOrder, status: 'Paid' }, // Simulating the updated status
      operation: 'update',
      previousDoc: testOrder, // Original order with 'Unpaid' status
    }
  }

  console.log('Simulated context:')
  console.log('  - Trigger type:', simulatedContext.trigger.type)
  console.log('  - Collection:', simulatedContext.trigger.collection)
  console.log('  - Doc status:', simulatedContext.trigger.doc.status)
  console.log('  - Previous doc status:', simulatedContext.trigger.previousDoc.status)

  // Test the condition used in workflow
  const condition = '$.doc.status == "Paid"'
  console.log(`\nTesting condition: ${condition}`)

  try {
    // Test left side JSONPath resolution
    const leftResult = JSONPath({
      json: simulatedContext,
      path: '$.trigger.doc.status',
      wrap: false
    })
    console.log(`  - Left side ($.trigger.doc.status): ${JSON.stringify(leftResult)} (type: ${typeof leftResult})`)

    // Test the comparison manually
    const comparisonMatch = condition.match(/^(.+?)\s*(==|!=|>|<|>=|<=)\s*(.+)$/)
    if (comparisonMatch) {
      const [, leftExpr, operator, rightExpr] = comparisonMatch
      console.log(`  - Left expression: "${leftExpr.trim()}"`)
      console.log(`  - Operator: "${operator}"`)
      console.log(`  - Right expression: "${rightExpr.trim()}"`)

      // Parse right side (remove quotes if it's a string literal)
      let rightValue = rightExpr.trim()
      if (rightValue.startsWith('"') && rightValue.endsWith('"')) {
        rightValue = rightValue.slice(1, -1)
      }
      console.log(`  - Right value: "${rightValue}" (type: ${typeof rightValue})`)

      const conditionResult = leftResult === rightValue
      console.log(`  - Condition result: ${conditionResult} (${leftResult} === ${rightValue})`)
    }

  } catch (error) {
    console.error('❌ JSONPath evaluation failed:', error.message)
  }

  // Step 4: Test workflow trigger matching logic
  console.log('\n🎯 Step 4: Testing trigger matching logic...')

  for (const workflow of workflows.docs) {
    console.log(`\nChecking workflow: "${workflow.name}"`)
    
    const triggers = workflow.triggers
    if (!triggers || !Array.isArray(triggers)) {
      console.log('  ❌ No triggers found')
      continue
    }

    for (const trigger of triggers) {
      console.log(`  Trigger details:`)
      console.log(`    - Type: ${trigger.type}`)
      console.log(`    - Collection: ${trigger.collection}`)
      console.log(`    - CollectionSlug: ${trigger.collectionSlug}`)
      console.log(`    - Operation: ${trigger.operation}`)
      console.log(`    - Condition: ${trigger.condition}`)

      // Check basic matching criteria
      const typeMatch = trigger.type === 'collection-trigger'
      const collectionMatch = trigger.collection === 'orders' || trigger.collectionSlug === 'orders'
      const operationMatch = trigger.operation === 'update'

      console.log(`    - Type match: ${typeMatch}`)
      console.log(`    - Collection match: ${collectionMatch}`)
      console.log(`    - Operation match: ${operationMatch}`)

      if (typeMatch && collectionMatch && operationMatch) {
        console.log(`  ✅ Basic trigger criteria match!`)
        
        if (trigger.condition) {
          console.log(`  Testing condition: ${trigger.condition}`)
          // Note: We'd need to call the actual evaluateCondition method here
          // but we're simulating the logic
        } else {
          console.log(`  ✅ No condition required - this trigger should fire!`)
        }
      } else {
        console.log(`  ❌ Basic trigger criteria don't match`)
      }
    }
  }

  // Step 5: Update order and trace hook execution
  console.log('\n🔄 Step 5: Updating order status to trigger workflow...')
  
  console.log('Before update - checking existing workflow runs:')
  const beforeRuns = await payload.find({
    collection: 'workflow-runs'
  })
  console.log(`  Existing workflow runs: ${beforeRuns.docs.length}`)

  console.log('\nUpdating order status to "Paid"...')
  const updatedOrder = await payload.update({
    collection: 'orders',
    id: testOrder.id,
    data: {
      status: 'Paid'
    }
  })

  console.log(`Order updated successfully. New status: "${updatedOrder.status}"`)

  // Wait a moment for async processing
  await new Promise(resolve => setTimeout(resolve, 3000))

  console.log('\nAfter update - checking for new workflow runs:')
  const afterRuns = await payload.find({
    collection: 'workflow-runs'
  })
  console.log(`  Total workflow runs: ${afterRuns.docs.length}`)
  console.log(`  New runs created: ${afterRuns.docs.length - beforeRuns.docs.length}`)

  if (afterRuns.docs.length > beforeRuns.docs.length) {
    const newRuns = afterRuns.docs.slice(0, afterRuns.docs.length - beforeRuns.docs.length)
    for (const run of newRuns) {
      console.log(`    - Run ID: ${run.id}`)
      console.log(`    - Workflow: ${run.workflow}`)
      console.log(`    - Status: ${run.status}`)
      console.log(`    - Context: ${JSON.stringify(run.context, null, 2)}`)
    }
  }

  // Step 6: Check job queue
  console.log('\n⚙️ Step 6: Checking job queue...')
  const jobs = await payload.find({
    collection: 'payload-jobs',
    sort: '-createdAt',
    limit: 10
  })

  console.log(`Recent jobs in queue: ${jobs.docs.length}`)
  for (const job of jobs.docs.slice(0, 5)) {
    console.log(`  - Job ${job.id}: ${job.taskSlug} (${job.processingError ? 'ERROR' : 'OK'})`)
  }

  console.log('\n✨ Debugging complete!')
  process.exit(0)
}

debugWorkflowExecution().catch(console.error)