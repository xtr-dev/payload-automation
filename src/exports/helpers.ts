/**
 * Trigger builder helpers for creating custom triggers with less boilerplate
 * 
 * @example
 * ```typescript
 * import { createTrigger, webhookTrigger } from '@xtr-dev/payload-automation/helpers'
 * 
 * // Simple trigger
 * const myTrigger = createTrigger('my-trigger').parameters({
 *   apiKey: { type: 'text', required: true },
 *   timeout: { type: 'number', defaultValue: 30 }
 * })
 * 
 * // Webhook trigger with presets
 * const orderWebhook = webhookTrigger('order-webhook')
 *   .parameter('orderTypes', {
 *     type: 'select',
 *     hasMany: true,
 *     options: ['regular', 'subscription']
 *   })
 *   .build()
 * ```
 */

// Core helpers
export {
  createTriggerParameter,
  createTriggerParameters,
  createTrigger,
  createAdvancedTrigger
} from '../utils/trigger-helpers.js'

// Preset builders
export {
  webhookTrigger,
  cronTrigger,
  eventTrigger,
  manualTrigger,
  apiTrigger
} from '../utils/trigger-presets.js'

// Common parameter sets for extending
export {
  webhookParameters,
  cronParameters,
  eventParameters
} from '../utils/trigger-presets.js'