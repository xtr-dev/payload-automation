// Isolated JSONPath condition testing
import { JSONPath } from 'jsonpath-plus'

function testJSONPathCondition() {
  console.log('🧪 Testing JSONPath condition evaluation in isolation')

  // Simulate the exact context structure from workflow execution
  const testContext = {
    steps: {},
    trigger: {
      type: 'collection',
      collection: 'orders',
      doc: {
        id: '12345',
        orderName: 'Test Order',
        status: 'Paid',  // This is the updated status
        customerEmail: 'test@example.com',
        totalPrice: 2500
      },
      operation: 'update',
      previousDoc: {
        id: '12345',
        orderName: 'Test Order', 
        status: 'Unpaid',  // This was the previous status
        customerEmail: 'test@example.com',
        totalPrice: 2500
      }
    }
  }

  console.log('Test context:')
  console.log('  - trigger.doc.status:', testContext.trigger.doc.status)
  console.log('  - trigger.previousDoc.status:', testContext.trigger.previousDoc.status)

  // Test different JSONPath expressions
  const testCases = [
    '$.trigger.doc.status',
    '$.doc.status',  // This is what your condition uses but might be wrong!
    '$.trigger.doc.status == "Paid"',
    '$.trigger.doc.status == "Unpaid"'
  ]

  console.log('\n📋 Testing JSONPath expressions:')
  
  for (const expression of testCases) {
    try {
      const result = JSONPath({
        json: testContext,
        path: expression,
        wrap: false
      })
      
      console.log(`  ✅ ${expression} => ${JSON.stringify(result)} (${typeof result})`)
    } catch (error) {
      console.log(`  ❌ ${expression} => ERROR: ${error.message}`)
    }
  }

  // Test comparison logic manually
  console.log('\n🔍 Testing comparison logic:')
  
  const condition = '$.doc.status == "Paid"'  // Your original condition
  const correctCondition = '$.trigger.doc.status == "Paid"'  // Likely correct path

  console.log(`\nTesting: ${condition}`)
  try {
    const leftResult = JSONPath({
      json: testContext,
      path: '$.doc.status',
      wrap: false
    })
    console.log(`  - Left side result: ${JSON.stringify(leftResult)}`)
    console.log(`  - Is undefined/null? ${leftResult === undefined || leftResult === null}`)
    console.log(`  - Comparison result: ${leftResult === 'Paid'}`)
  } catch (error) {
    console.log(`  - Error: ${error.message}`)
  }

  console.log(`\nTesting: ${correctCondition}`)
  try {
    const leftResult = JSONPath({
      json: testContext,
      path: '$.trigger.doc.status',
      wrap: false
    })
    console.log(`  - Left side result: ${JSON.stringify(leftResult)}`)
    console.log(`  - Comparison result: ${leftResult === 'Paid'}`)
  } catch (error) {
    console.log(`  - Error: ${error.message}`)
  }

  // Test regex parsing
  console.log('\n📝 Testing regex parsing:')
  const testConditions = [
    '$.trigger.doc.status == "Paid"',
    '$.doc.status == "Paid"',
    '$.trigger.doc.status=="Paid"',  // No spaces
    "$.trigger.doc.status == 'Paid'"  // Single quotes
  ]

  for (const cond of testConditions) {
    const comparisonMatch = cond.match(/^(.+?)\s*(==|!=|>|<|>=|<=)\s*(.+)$/)
    if (comparisonMatch) {
      const [, leftExpr, operator, rightExpr] = comparisonMatch
      console.log(`  ✅ ${cond}`)
      console.log(`    - Left: "${leftExpr.trim()}"`)
      console.log(`    - Operator: "${operator}"`)
      console.log(`    - Right: "${rightExpr.trim()}"`)
    } else {
      console.log(`  ❌ ${cond} - No regex match`)
    }
  }
}

testJSONPathCondition()