import type {Field} from 'payload'

import {triggerField} from "./helpers.js"

export function getWebhookTriggerFields(): Field[] {
  return [
    triggerField({
      name: 'webhookPath',
      type: 'text',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'webhook-trigger',
        description: 'URL path for the webhook (e.g., "my-webhook"). Full URL will be /api/workflows-webhook/my-webhook',
      },
      validate: (value: any, {siblingData}: any) => {
        if (siblingData?.type === 'webhook-trigger' && !value && !siblingData?.parameters?.webhookPath) {
          return 'Webhook path is required for webhook triggers'
        }
        return true
      },
    })
  ]
}