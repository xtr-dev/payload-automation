// Test script to create workflow with correct v0.0.15 schema structure
const { getPayload } = require('payload')

async function testWorkflowCreation() {
  const payload = await getPayload({ 
    config: require('./dev/payload.config.ts').default 
  })

  console.log('🚀 Creating workflow with v0.0.15 schema...')

  try {
    const workflow = await payload.create({
      collection: 'workflows',
      data: {
        name: 'Test Order Status Workflow v0.0.15',
        description: 'Test workflow that triggers when order status changes to Paid',
        enabled: true,
        triggers: [
          {
            type: 'collection-trigger',
            collectionSlug: 'orders',
            operation: 'update',
            // v0.0.15 uses 'condition' (singular) with JSONPath expressions
            // instead of 'conditions' array
            condition: '$.doc.status == "Paid"'
          }
        ],
        steps: [
          {
            // v0.0.15 uses 'step' field instead of 'type'
            step: 'uppercaseText',
            name: 'Test Uppercase Step',
            // v0.0.15 uses 'input' (singular) instead of 'inputs'
            input: {
              inputText: 'Order {{$.trigger.doc.orderName}} has been paid!'
            }
          }
        ]
      }
    })

    console.log('✅ Workflow created successfully!')
    console.log('📋 Workflow details:')
    console.log('  - ID:', workflow.id)
    console.log('  - Name:', workflow.name)
    console.log('  - Triggers:', JSON.stringify(workflow.triggers, null, 2))
    console.log('  - Steps:', JSON.stringify(workflow.steps, null, 2))

    // Now test with an order update
    console.log('\n🔄 Testing order status change...')
    
    // First create a test order
    const order = await payload.create({
      collection: 'orders',
      data: {
        orderName: 'Test Order - ' + Date.now(),
        status: 'Unpaid',
        customerEmail: 'test@example.com',
        totalPrice: 2500,
        items: [
          {
            name: 'Test Item',
            quantity: 1,
            price: 2500
          }
        ]
      }
    })

    console.log('📦 Test order created:', order.id)

    // Update order status to trigger workflow
    const updatedOrder = await payload.update({
      collection: 'orders',
      id: order.id,
      data: {
        status: 'Paid'
      }
    })

    console.log('💰 Order status updated to:', updatedOrder.status)

    // Wait a moment for async workflow execution
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Check for workflow runs
    const workflowRuns = await payload.find({
      collection: 'workflow-runs',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })

    console.log(`\n📊 Workflow runs found: ${workflowRuns.docs.length}`)
    
    if (workflowRuns.docs.length > 0) {
      const run = workflowRuns.docs[0]
      console.log('  - Run ID:', run.id)
      console.log('  - Status:', run.status)
      console.log('  - Context:', JSON.stringify(run.context, null, 2))
    }

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }

  process.exit(0)
}

testWorkflowCreation()