# Migration Guide: v0.0.23 → v0.0.24

## What's New

Version 0.0.24 introduces **trigger builder helpers** that dramatically reduce boilerplate when creating custom triggers, plus fixes field name clashing between built-in and external trigger parameters.

## Breaking Changes

**None** - This is a fully backward-compatible release. All existing triggers continue to work exactly as before.

## New Features

### 1. Trigger Builder Helpers

New helper functions eliminate 90% of boilerplate when creating custom triggers:

```bash
npm update @xtr-dev/payload-automation
```

```typescript
// Import the new helpers
import { 
  createTrigger, 
  webhookTrigger, 
  cronTrigger 
} from '@xtr-dev/payload-automation/helpers'
```

### 2. Fixed Field Name Clashing

Built-in trigger parameters now use a JSON backing store to prevent conflicts with custom trigger fields.

## Migration Steps

### Step 1: Update Package

```bash
npm install @xtr-dev/payload-automation@latest
# or
pnpm update @xtr-dev/payload-automation
```

### Step 2: (Optional) Modernize Custom Triggers

**Your existing triggers will continue to work**, but you can optionally migrate to the cleaner syntax:

#### Before (Still Works)
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
    }
    // ... more boilerplate
  ]
}
```

#### After (Recommended)
```typescript
import { createTrigger } from '@xtr-dev/payload-automation/helpers'

const orderWebhook = createTrigger('order-webhook').parameters({
  webhookSecret: {
    type: 'text',
    required: true,
    admin: {
      description: 'Secret for webhook validation'
    }
  }
  // Add more parameters easily
})
```

### Step 3: (Optional) Use Preset Builders

For common trigger patterns:

```typescript
import { webhookTrigger, cronTrigger } from '@xtr-dev/payload-automation/helpers'

// Webhook trigger with built-in path, secret, headers parameters
const paymentWebhook = webhookTrigger('payment-webhook')
  .parameter('currency', {
    type: 'select',
    options: ['USD', 'EUR', 'GBP']
  })
  .build()

// Cron trigger with built-in expression, timezone parameters  
const dailyReport = cronTrigger('daily-report')
  .parameter('format', {
    type: 'select',
    options: ['pdf', 'csv']
  })
  .build()
```

## Quick Migration Examples

### Simple Trigger Migration

```typescript
// OLD WAY (still works)
{
  slug: 'user-signup',
  inputs: [/* 20+ lines of boilerplate per field */]
}

// NEW WAY (recommended)
import { createTrigger } from '@xtr-dev/payload-automation/helpers'

const userSignup = createTrigger('user-signup').parameters({
  source: {
    type: 'select',
    options: ['web', 'mobile', 'api'],
    required: true
  },
  userType: {
    type: 'select', 
    options: ['regular', 'premium'],
    defaultValue: 'regular'
  }
})
```

### Webhook Trigger Migration

```typescript
// OLD WAY
{
  slug: 'payment-webhook',
  inputs: [/* Manual webhookPath field + lots of boilerplate */]
}

// NEW WAY  
import { webhookTrigger } from '@xtr-dev/payload-automation/helpers'

const paymentWebhook = webhookTrigger('payment-webhook')
  .parameter('minimumAmount', { 
    type: 'number', 
    min: 0 
  })
  .build()
```

## Benefits of Migration

- **90% less code** - Eliminate virtual field boilerplate
- **No field name conflicts** - Built-in parameters isolated
- **Better TypeScript support** - Full type inference
- **Preset patterns** - Common trigger types ready-to-use
- **Composable API** - Easy to extend and customize

## Compatibility

- ✅ **Existing triggers** continue to work unchanged
- ✅ **Mix old and new** trigger styles in same config
- ✅ **No database changes** required
- ✅ **PayloadCMS field compatibility** maintained

## Need Help?

- [View examples](./examples/trigger-builders.ts)
- [Read documentation](./examples/README-trigger-builders.md)
- [Report issues](https://github.com/xtr-dev/payload-automation/issues)

---

**TL;DR**: Update the package, optionally migrate custom triggers to use the new helpers for cleaner code. All existing triggers continue to work without changes.