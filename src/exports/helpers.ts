/**
 * Trigger builder helpers for creating custom triggers with less boilerplate
 * 
 * @example
 * ```typescript
 * import { createTrigger, createTriggerField, webhookTrigger } from '@xtr-dev/payload-automation/helpers'
 * 
 * // Simple trigger with array of fields
 * const myTrigger = createTrigger('my-trigger', [
 *   { name: 'apiKey', type: 'text', required: true },
 *   { name: 'timeout', type: 'number', defaultValue: 30 }
 * ])
 * 
 * // Single field with virtual storage
 * const field = createTriggerField(
 *   { name: 'webhookUrl', type: 'text', required: true },
 *   'my-trigger'
 * )
 * 
 * // Webhook trigger preset
 * const orderWebhook = webhookTrigger('order-webhook')
 * ```
 */

// Core helpers
export {
  createTriggerField,
  createTrigger
} from '../utils/trigger-helpers.js'

// Preset builders
export {
  webhookTrigger,
  cronTrigger,
  eventTrigger,
  manualTrigger,
  apiTrigger
} from '../utils/trigger-presets.js'