// Comprehensive diagnostic script for hook registration issues
// This should be run in your actual PayloadCMS environment

console.log('🔍 === COMPREHENSIVE HOOK DIAGNOSTIC ===')

// STEP 1: Add this to your payload.config.ts or wherever you initialize PayloadCMS
console.log(`
📋 STEP 1: Add this diagnostic code to your PayloadCMS initialization:

// After PayloadCMS is initialized, run this diagnostic
const diagnostic = async () => {
  console.log('🔍 === HOOK REGISTRATION DIAGNOSTIC ===')
  
  // Check if orders collection exists
  const ordersCollection = payload.collections.orders
  if (!ordersCollection) {
    console.log('❌ CRITICAL: orders collection not found!')
    console.log('Available collections:', Object.keys(payload.collections))
    return
  }
  
  console.log('✅ orders collection found')
  
  // Check hooks on orders collection
  const hooks = ordersCollection.config.hooks
  console.log('Orders collection hooks:')
  console.log('  - afterChange:', hooks?.afterChange?.length || 0)
  console.log('  - afterRead:', hooks?.afterRead?.length || 0) 
  console.log('  - afterDelete:', hooks?.afterDelete?.length || 0)
  
  // If no hooks, something is wrong
  if (!hooks?.afterChange || hooks.afterChange.length === 0) {
    console.log('❌ CRITICAL: No afterChange hooks registered on orders collection!')
    console.log('This means the automation plugin hook registration failed.')
    return
  }
  
  // Test hook execution by manually calling them
  console.log('\\n🧪 Testing hook execution manually...')
  
  const testDoc = {
    id: 'test-' + Date.now(),
    orderName: 'Test Order',
    status: 'Paid',
    customerEmail: 'test@example.com',
    totalPrice: 1000
  }
  
  const previousDoc = {
    ...testDoc,
    status: 'Unpaid'
  }
  
  // Create a mock change object
  const mockChange = {
    collection: { slug: 'orders' },
    operation: 'update',
    doc: testDoc,
    previousDoc: previousDoc,
    req: {} // minimal request object
  }
  
  console.log('Calling hooks manually with test data...')
  
  for (let i = 0; i < hooks.afterChange.length; i++) {
    try {
      console.log(\`Calling hook #\${i + 1}...\`)
      await hooks.afterChange[i](mockChange)
      console.log(\`✅ Hook #\${i + 1} completed\`)
    } catch (error) {
      console.log(\`❌ Hook #\${i + 1} failed:\`, error.message)
    }
  }
}

// Run diagnostic after PayloadCMS is fully initialized
setTimeout(diagnostic, 2000)
`)

console.log(`
📋 STEP 2: Check your plugin configuration

Verify your payload.config.ts includes the orders collection:

automationPlugin({
  collections: ['orders'],  // ← MUST include 'orders'
  // ... other config
})

NOT:
automationPlugin({
  collections: ['users', 'products'],  // ← Missing 'orders'!
})
`)

console.log(`
📋 STEP 3: Alternative hook registration test

Add this to your order update code to manually verify hooks:

// Before updating the order
console.log('🔍 Pre-update hook check:')
const orderCollection = payload.collections.orders
console.log('afterChange hooks count:', orderCollection.config.hooks?.afterChange?.length)

// Update the order
const result = await payload.update({...})

// Check for workflow runs immediately
const runs = await payload.find({ collection: 'workflow-runs' })
console.log('Workflow runs after update:', runs.docs.length)
`)

console.log(`
📋 STEP 4: Most likely root causes

1. Plugin Configuration Issue:
   - 'orders' not included in collections array
   - Plugin disabled or not properly applied
   
2. Collection Name Mismatch:
   - Your collection might be named differently (e.g., 'order' vs 'orders')
   - Case sensitivity issue
   
3. Hook Registration Timing:
   - Plugin hooks registered before collection is fully initialized
   - Race condition in PayloadCMS startup
   
4. Development Environment Issue:
   - Hot reloading interfering with hook registration
   - Multiple PayloadCMS instances
   
5. Database/Collection Issue:
   - Collection doesn't exist in database
   - Collection configuration mismatch
`)

console.log(`
🆘 QUICK DEBUG COMMANDS

Run these in your browser console or Node.js environment:

// Check available collections
Object.keys(payload.collections)

// Check specific collection hooks
payload.collections.orders?.config?.hooks?.afterChange?.length

// Check plugin configuration (if accessible)
// This depends on how your config is structured
`)

process.exit(0)