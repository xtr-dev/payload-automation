# Trigger Builder Examples

The new trigger builder API dramatically reduces boilerplate when creating custom triggers.

## Before vs After

### Before (Manual Approach)
```typescript
const customTrigger = {
  slug: 'order-webhook',
  inputs: [
    {
      name: 'webhookSecret',
      type: 'text',
      required: true,
      virtual: true,
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'order-webhook',
        description: 'Secret for webhook validation'
      },
      hooks: {
        afterRead: [({ siblingData }) => siblingData?.parameters?.webhookSecret],
        beforeChange: [({ value, siblingData }) => {
          if (!siblingData.parameters) siblingData.parameters = {}
          siblingData.parameters.webhookSecret = value
          return undefined
        }]
      }
    },
    {
      name: 'orderStatuses',
      type: 'select',
      hasMany: true,
      options: ['pending', 'processing', 'completed'],
      defaultValue: ['completed'],
      virtual: true,
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'order-webhook',
        description: 'Order statuses that trigger the workflow'
      },
      hooks: {
        afterRead: [({ siblingData }) => siblingData?.parameters?.orderStatuses || ['completed']],
        beforeChange: [({ value, siblingData }) => {
          if (!siblingData.parameters) siblingData.parameters = {}
          siblingData.parameters.orderStatuses = value
          return undefined
        }]
      }
    }
    // ... imagine more fields with similar boilerplate
  ]
}
```

### After (Builder Approach)
```typescript
import { createTrigger } from '@xtr-dev/payload-automation/helpers'

const orderWebhook = createTrigger('order-webhook').parameters({
  webhookSecret: {
    type: 'text',
    required: true,
    admin: {
      description: 'Secret for webhook validation'
    }
  },
  orderStatuses: {
    type: 'select',
    hasMany: true,
    options: ['pending', 'processing', 'completed'],
    defaultValue: ['completed'],
    admin: {
      description: 'Order statuses that trigger the workflow'
    }
  }
})
```

## Built-in Trigger Presets

### Webhook Trigger
```typescript
import { webhookTrigger } from '@xtr-dev/payload-automation/helpers'

const paymentWebhook = webhookTrigger('payment-webhook')
  .parameter('currency', {
    type: 'select',
    options: ['USD', 'EUR', 'GBP'],
    defaultValue: 'USD'
  })
  .build()
```

### Scheduled/Cron Trigger
```typescript
import { cronTrigger } from '@xtr-dev/payload-automation/helpers'

const dailyReport = cronTrigger('daily-report')
  .parameter('reportFormat', {
    type: 'select',
    options: ['pdf', 'csv', 'json'],
    defaultValue: 'pdf'
  })
  .build()
```

### Manual Trigger (No Parameters)
```typescript
import { manualTrigger } from '@xtr-dev/payload-automation/helpers'

const backupTrigger = manualTrigger('manual-backup')
```

## Advanced Usage

### Extending Common Parameters
```typescript
import { createAdvancedTrigger, webhookParameters } from '@xtr-dev/payload-automation/helpers'

const advancedWebhook = createAdvancedTrigger('advanced-webhook')
  .extend(webhookParameters) // Includes path, secret, headers
  .parameter('retryAttempts', {
    type: 'number',
    min: 0,
    max: 5,
    defaultValue: 3
  })
  .parameter('timeout', {
    type: 'number',
    min: 1000,
    max: 30000,
    defaultValue: 5000,
    admin: {
      description: 'Timeout in milliseconds'
    }
  })
  .build()
```

### Custom Validation
```typescript
const validatedTrigger = createTrigger('validated-trigger').parameters({
  email: {
    type: 'email',
    required: true,
    validate: (value) => {
      if (value?.endsWith('@spam.com')) {
        return 'Spam domains not allowed'
      }
      return true
    }
  },
  webhookUrl: {
    type: 'text',
    required: true,
    validate: (value) => {
      try {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol)) {
          return 'Only HTTP/HTTPS URLs allowed'
        }
      } catch {
        return 'Please enter a valid URL'
      }
      return true
    }
  }
})
```

## Usage in Plugin Configuration

```typescript
import { workflowsPlugin } from '@xtr-dev/payload-automation'
import { 
  createTrigger, 
  webhookTrigger, 
  cronTrigger 
} from '@xtr-dev/payload-automation/helpers'

export default buildConfig({
  plugins: [
    workflowsPlugin({
      triggers: [
        // Mix different trigger types
        createTrigger('user-signup').parameters({
          source: {
            type: 'select',
            options: ['web', 'mobile', 'api'],
            required: true
          }
        }),
        
        webhookTrigger('payment-received')
          .parameter('minimumAmount', { type: 'number', min: 0 })
          .build(),
          
        cronTrigger('weekly-cleanup')
          .parameter('deleteOlderThan', {
            type: 'number',
            defaultValue: 30,
            admin: { description: 'Delete records older than N days' }
          })
          .build()
      ]
    })
  ]
})
```

## Benefits

- **90% less boilerplate** - No manual hooks, conditions, or virtual field setup
- **Type safety** - Full TypeScript support
- **Reusable patterns** - Common trigger types as presets  
- **Composable** - Mix builders with manual fields
- **Backward compatible** - Existing triggers continue to work
- **Validation built-in** - Parameter validation handled automatically