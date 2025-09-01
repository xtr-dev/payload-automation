# 🔍 CRITICAL DIAGNOSTIC: Why The Plugin Works Locally But Not For You

## The Key Insight

Our tests work because we define collections **inline** in the config:

```typescript
// OUR TEST ENVIRONMENT - WORKS
export default buildConfig({
  collections: [
    {
      slug: 'posts',
      fields: [...],
      // Collection defined RIGHT HERE
    }
  ],
  plugins: [
    workflowsPlugin({...}) // Plugin can see collections above
  ]
})
```

## The Likely Customer Setup

You probably have collections defined **separately**:

```typescript
// YOUR ENVIRONMENT - LIKELY STRUCTURE
import { Orders } from './collections/Orders'
import { Users } from './collections/Users'
import { Products } from './collections/Products'

export default buildConfig({
  collections: [
    Orders,  // Imported from separate file
    Users,   // Imported from separate file
    Products // Imported from separate file
  ],
  plugins: [
    workflowsPlugin({...}) // Plugin runs but collections might be different
  ]
})
```

## The Critical Question

**How are your collections defined?**

### Option 1: Separate Files (Most Common)
```typescript
// collections/Orders.ts
export const Orders: CollectionConfig = {
  slug: 'orders',
  hooks: {
    // Your existing hooks here
  },
  fields: [...]
}
```

### Option 2: Factory Functions
```typescript
// collections/Orders.ts
export const Orders = (): CollectionConfig => ({
  slug: 'orders',
  // ...
})
```

### Option 3: Class-based or Complex Setup
```typescript
// Something more complex that might not be in config.collections yet
```

## 🚨 THE DIAGNOSTIC TEST

Add this to your payload.config.ts BEFORE the workflowsPlugin:

```typescript
export default buildConfig({
  collections: [Orders, Users, Products],
  plugins: [
    // ADD THIS DIAGNOSTIC PLUGIN FIRST
    (config) => {
      console.log('🔍 DIAGNOSTIC: Collections in config:')
      console.log('  - config.collections exists?', !!config.collections)
      console.log('  - config.collections length:', config.collections?.length)
      console.log('  - Collection slugs:', config.collections?.map(c => c.slug))
      
      // Check if orders collection has hooks already
      const ordersConfig = config.collections?.find(c => c.slug === 'orders')
      console.log('  - Orders collection found?', !!ordersConfig)
      console.log('  - Orders has hooks?', !!ordersConfig?.hooks)
      console.log('  - Orders afterChange hooks:', ordersConfig?.hooks?.afterChange?.length || 0)
      
      return config
    },
    
    // THEN your automation plugin
    workflowsPlugin({...})
  ]
})
```

## 🎯 What This Will Tell Us

1. **If collections show up**: The plugin should work with v0.0.20
2. **If collections are empty/undefined**: That's why hooks aren't registering
3. **If orders already has hooks**: There might be a conflict

## 💡 The Likely Solution

If your collections are in separate files, you might need to:

### Option A: Add hooks directly to collection files
```typescript
// collections/Orders.ts
import { automationHook } from '@xtr-dev/payload-automation/hooks' // We'd need to export this

export const Orders: CollectionConfig = {
  slug: 'orders',
  hooks: {
    afterChange: [
      automationHook, // Add directly here
      // ... your other hooks
    ]
  }
}
```

### Option B: Modify collections before passing to buildConfig
```typescript
// payload.config.ts
import { Orders } from './collections/Orders'
import { addAutomationHooks } from '@xtr-dev/payload-automation/utils' // We'd need to create this

const OrdersWithAutomation = addAutomationHooks(Orders)

export default buildConfig({
  collections: [OrdersWithAutomation, Users, Products],
  // ...
})
```

## 🔑 The Bottom Line

**The plugin works when collections are defined inline because they exist in `config.collections` when the plugin runs.**

**If your collections are imported from separate files, they might not be in the right structure for the plugin to modify them.**

Run the diagnostic above and share the console output - it will tell us exactly why the hooks aren't registering in your environment!