// Hook verification test - run this in your PayloadCMS environment
// This will help identify why registered hooks aren't executing

console.log('🔍 === HOOK VERIFICATION TEST ===')

console.log(`
Add this code to your PayloadCMS environment after initialization:

const verifyHooks = async () => {
  console.log('🔍 === HOOK VERIFICATION DIAGNOSTIC ===')
  
  // 1. Check if hooks are still registered
  const ordersCollection = payload.collections.orders
  const hooks = ordersCollection.config.hooks.afterChange || []
  
  console.log('Hook count:', hooks.length)
  console.log('Hook types:', hooks.map((h, i) => \`#\${i}: \${typeof h}\`))
  
  // 2. Check if hooks are actually functions
  for (let i = 0; i < hooks.length; i++) {
    const hook = hooks[i]
    console.log(\`Hook #\${i}:\`)
    console.log(\`  - Type: \${typeof hook}\`)
    console.log(\`  - Is Function: \${typeof hook === 'function'}\`)
    console.log(\`  - Has Name: \${hook.name || 'anonymous'}\`)
    console.log(\`  - String Preview: \${hook.toString().substring(0, 100)}...\`)
  }
  
  // 3. Try to manually execute each hook
  console.log('\\n🧪 MANUAL HOOK EXECUTION TEST')
  
  const mockChange = {
    collection: { slug: 'orders' },
    operation: 'update',
    doc: {
      id: 'test-' + Date.now(),
      orderName: 'Test Order',
      status: 'Paid',
      customerEmail: 'test@example.com'
    },
    previousDoc: {
      id: 'test-' + Date.now(),
      orderName: 'Test Order', 
      status: 'Unpaid',
      customerEmail: 'test@example.com'
    },
    req: { user: null } // Minimal request object
  }
  
  for (let i = 0; i < hooks.length; i++) {
    try {
      console.log(\`\\nTesting hook #\${i}...\`)
      console.log('About to call hook with mock data')
      
      const result = await hooks[i](mockChange)
      
      console.log(\`✅ Hook #\${i} executed successfully\`)
      console.log('Result:', result)
      
    } catch (error) {
      console.log(\`❌ Hook #\${i} failed:\`)
      console.log('Error:', error.message)
      console.log('Stack:', error.stack)
    }
  }
  
  // 4. Check if hooks are being called during real operations
  console.log('\\n🔍 REAL OPERATION TEST')
  console.log('Creating a test order to see if hooks fire...')
  
  // Add a simple test hook to verify hook execution
  const testHook = async (change) => {
    console.log('🚨 TEST HOOK FIRED! 🚨')
    console.log('Collection:', change.collection.slug)
    console.log('Operation:', change.operation)
  }
  
  // Add test hook at the beginning
  ordersCollection.config.hooks.afterChange.unshift(testHook)
  console.log('Added test hook at position 0')
  
  try {
    const testOrder = await payload.create({
      collection: 'orders',
      data: {
        orderName: 'Hook Verification Test',
        status: 'Unpaid',
        customerEmail: 'hooktest@example.com',
        totalPrice: 1000,
        items: [{ name: 'Test Item', quantity: 1, price: 1000 }]
      }
    })
    
    console.log('Test order created:', testOrder.id)
    
    // Update the order to trigger hooks
    const updatedOrder = await payload.update({
      collection: 'orders', 
      id: testOrder.id,
      data: { status: 'Paid' }
    })
    
    console.log('Test order updated to:', updatedOrder.status)
    
  } catch (error) {
    console.log('Error during test operation:', error.message)
  }
}

// Run after PayloadCMS is initialized
setTimeout(verifyHooks, 3000)
`)

console.log(`
🎯 Expected Results:

If you see "🚨 TEST HOOK FIRED! 🚨" but NOT the automation plugin messages:
- Hook execution works, but the automation plugin hook has an issue
- Likely problem: Hook function malformed or has runtime error

If you DON'T see "🚨 TEST HOOK FIRED! 🚨":
- Hook execution is completely broken
- PayloadCMS configuration or timing issue

If hooks execute manually but not during real operations:
- Hook registration timing issue
- PayloadCMS lifecycle problem
`)

process.exit(0)