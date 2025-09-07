/**
 * Examples demonstrating the new trigger builder API
 * This shows the before/after comparison and various usage patterns
 */

import { 
  createTrigger, 
  createAdvancedTrigger,
  webhookTrigger, 
  cronTrigger, 
  eventTrigger,
  manualTrigger,
  apiTrigger,
  webhookParameters,
  cronParameters 
} from '../src/exports/helpers.js'

/**
 * BEFORE: Manual trigger definition with lots of boilerplate
 */
const oldWayTrigger = {
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
} as const

/**
 * AFTER: Clean trigger definition using builders
 */

// 1. Simple trigger with parameters
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
  },
  minimumAmount: {
    type: 'number',
    min: 0,
    admin: {
      description: 'Minimum order amount to trigger workflow'
    }
  }
})

// 2. Using preset webhook builder
const paymentWebhook = webhookTrigger('payment-webhook')
  .parameter('currency', {
    type: 'select',
    options: ['USD', 'EUR', 'GBP'],
    defaultValue: 'USD'
  })
  .parameter('paymentMethods', {
    type: 'select',
    hasMany: true,
    options: ['credit_card', 'paypal', 'bank_transfer']
  })
  .build()

// 3. Scheduled trigger using cron builder
const dailyReport = cronTrigger('daily-report')
  .parameter('reportFormat', {
    type: 'select',
    options: [
      { label: 'PDF Report', value: 'pdf' },
      { label: 'CSV Export', value: 'csv' },
      { label: 'JSON Data', value: 'json' }
    ],
    defaultValue: 'pdf'
  })
  .parameter('includeCharts', {
    type: 'checkbox',
    defaultValue: true,
    admin: {
      description: 'Include visual charts in the report'
    }
  })
  .build()

// 4. Event-driven trigger
const userActivity = eventTrigger('user-activity')
  .parameter('actionTypes', {
    type: 'select',
    hasMany: true,
    options: ['login', 'logout', 'profile_update', 'password_change'],
    admin: {
      description: 'User actions that should trigger this workflow'
    }
  })
  .parameter('userRoles', {
    type: 'select',
    hasMany: true,
    options: ['admin', 'editor', 'user'],
    admin: {
      description: 'Only trigger for users with these roles'
    }
  })
  .build()

// 5. Simple manual trigger (no parameters)
const manualBackup = manualTrigger('manual-backup')

// 6. API trigger with authentication
const externalApi = apiTrigger('external-api')
  .parameter('allowedOrigins', {
    type: 'textarea',
    admin: {
      description: 'Comma-separated list of allowed origins'
    },
    validate: (value) => {
      if (value && typeof value === 'string') {
        const origins = value.split(',').map(s => s.trim())
        const validOrigins = origins.every(origin => {
          try {
            new URL(origin)
            return true
          } catch {
            return false
          }
        })
        if (!validOrigins) {
          return 'All origins must be valid URLs'
        }
      }
      return true
    }
  })
  .build()

// 7. Complex trigger extending common parameters
const advancedWebhook = createAdvancedTrigger('advanced-webhook')
  .extend(webhookParameters) // Start with webhook basics
  .parameter('retryConfig', {
    type: 'group',
    fields: [
      {
        name: 'maxRetries',
        type: 'number',
        min: 0,
        max: 10,
        defaultValue: 3
      },
      {
        name: 'retryDelay',
        type: 'number',
        min: 1000,
        max: 60000,
        defaultValue: 5000,
        admin: {
          description: 'Delay between retries in milliseconds'
        }
      }
    ]
  })
  .parameter('filters', {
    type: 'array',
    fields: [
      {
        name: 'field',
        type: 'text',
        required: true
      },
      {
        name: 'operator',
        type: 'select',
        options: ['equals', 'not_equals', 'contains', 'greater_than'],
        required: true
      },
      {
        name: 'value',
        type: 'text',
        required: true
      }
    ]
  })
  .build()

// 8. Custom parameter validation
const validatedTrigger = createTrigger('validated-trigger').parameters({
  email: {
    type: 'email',
    required: true,
    validate: (value) => {
      if (value && typeof value === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) {
          return 'Please enter a valid email address'
        }
        // Custom business logic validation
        if (value.endsWith('@example.com')) {
          return 'Example.com emails are not allowed'
        }
      }
      return true
    }
  },
  webhookUrl: {
    type: 'text',
    required: true,
    validate: (value) => {
      if (value && typeof value === 'string') {
        try {
          const url = new URL(value)
          if (!['http:', 'https:'].includes(url.protocol)) {
            return 'URL must use HTTP or HTTPS protocol'
          }
          if (url.hostname === 'localhost') {
            return 'Localhost URLs are not allowed in production'
          }
        } catch {
          return 'Please enter a valid URL'
        }
      }
      return true
    }
  }
})

/**
 * Export all triggers for use in plugin configuration
 */
export const exampleTriggers = [
  orderWebhook,
  paymentWebhook,
  dailyReport,
  userActivity,
  manualBackup,
  externalApi,
  advancedWebhook,
  validatedTrigger
]

/**
 * Usage in payload.config.ts:
 * 
 * ```typescript
 * import { workflowsPlugin } from '@xtr-dev/payload-automation'
 * import { exampleTriggers } from './examples/trigger-builders'
 * 
 * export default buildConfig({
 *   plugins: [
 *     workflowsPlugin({
 *       triggers: exampleTriggers,
 *       // ... other config
 *     })
 *   ]
 * })
 * ```
 */