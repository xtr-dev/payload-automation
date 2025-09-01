// Debug script to identify customer-side configuration issues
// Run this in your environment to pinpoint the problem

console.log('🔍 === CUSTOMER ENVIRONMENT DEBUGGING ===')

// This script needs to be run in your actual environment
// Copy this logic into your own debugging script

const debugChecklist = {
  "Plugin Version": "Check package.json for @xtr-dev/payload-automation version",
  "Plugin Configuration": "Verify automationPlugin() is called with correct collections array", 
  "Database Collections": "Confirm 'workflows' and 'workflow-runs' collections exist",
  "Hook Registration": "Check if afterChange hooks are actually registered on orders collection",
  "Workflow Status": "Verify workflow document has _status: 'published'",
  "Workflow Structure": "Confirm triggers array and steps array are populated",
  "Order Collection": "Verify orders collection exists and is configured in plugin",
  "PayloadCMS Version": "Check if you're using compatible Payload version",
  "Environment": "Development vs Production database differences"
}

console.log('\n📋 Debugging Checklist for Your Environment:')
Object.entries(debugChecklist).forEach(([check, description], i) => {
  console.log(`${i + 1}. ${check}: ${description}`)
})

console.log('\n🔍 Specific Things to Check in YOUR Environment:')

console.log('\n1. Plugin Configuration (payload.config.ts):')
console.log(`   automationPlugin({
     collections: ['orders', 'users', 'products'], // <- Must include 'orders'
     // ... other config
   })`)

console.log('\n2. Database Query (run this in your environment):')
console.log(`   const workflows = await payload.find({
     collection: 'workflows',
     depth: 2
   })
   console.log('Found workflows:', workflows.docs.length)
   console.log('Workflow details:', JSON.stringify(workflows.docs, null, 2))`)

console.log('\n3. Hook Registration Check:')
console.log(`   const orderCollection = payload.collections.orders
   console.log('afterChange hooks:', orderCollection.config.hooks?.afterChange?.length)`)

console.log('\n4. Manual Hook Trigger Test:')
console.log(`   // Manually call the executor method
   const executor = // get executor instance somehow
   await executor.executeTriggeredWorkflows('orders', 'update', updatedDoc, previousDoc, req)`)

console.log('\n5. Most Likely Issues:')
console.log('   - Plugin not configured with "orders" in collections array')
console.log('   - Workflow is in draft status (not published)')
console.log('   - Database connection issue (different DB in dev vs prod)')
console.log('   - PayloadCMS version compatibility issue')
console.log('   - Hook execution order (automation hook not running last)')

console.log('\n💡 Quick Test - Add this to your order update code:')
console.log(`   console.log('🔍 DEBUG: About to update order')
   const result = await payload.update({ ... })
   console.log('🔍 DEBUG: Order updated, hooks should have fired')
   
   // Check immediately after
   const runs = await payload.find({ collection: 'workflow-runs' })
   console.log('🔍 DEBUG: Workflow runs after update:', runs.docs.length)`)

process.exit(0)