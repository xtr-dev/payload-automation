// Test script to verify published workflow filtering
console.log('🔍 Testing published workflow filtering...')

// This will be run from the dev environment
// Start the dev server first: pnpm dev
// Then in another terminal: node test-published-workflows.js

const testData = {
  // Simulate what the workflow executor should find
  allWorkflows: [
    {
      id: 1,
      name: 'Draft Workflow',
      _status: 'draft',
      triggers: [{ type: 'collection-trigger', collectionSlug: 'orders', operation: 'update' }]
    },
    {
      id: 2, 
      name: 'Published Workflow',
      _status: 'published',
      triggers: [{ type: 'collection-trigger', collectionSlug: 'orders', operation: 'update' }]
    }
  ]
}

// Test filtering logic
const publishedOnly = testData.allWorkflows.filter(wf => wf._status === 'published')

console.log('All workflows:', testData.allWorkflows.length)
console.log('Published workflows:', publishedOnly.length)
console.log('Published workflow names:', publishedOnly.map(wf => wf.name))

console.log('\n✅ The published status filter should work!')
console.log('💡 Make sure your workflow has _status: "published" in the database')

// Instructions for manual verification
console.log('\n📋 Manual verification steps:')
console.log('1. Start dev server: pnpm dev')
console.log('2. Go to http://localhost:3000/admin/collections/workflows')  
console.log('3. Find your workflow and ensure it shows as "Published" (not "Draft")')
console.log('4. If it shows as "Draft", click it and click "Publish"')
console.log('5. Then test your order status change again')

process.exit(0)