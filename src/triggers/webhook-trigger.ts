import type { Field } from 'payload'

export function getWebhookTriggerFields(): Field[] {
  return [
    {
      name: '__builtin_webhookPath',
      type: 'text',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'webhook-trigger',
        description: 'URL path for the webhook (e.g., "my-webhook"). Full URL will be /api/workflows-webhook/my-webhook',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            return siblingData?.parameters?.webhookPath || undefined
          }
        ],
        beforeChange: [
          ({ siblingData, value }) => {
            if (!siblingData.parameters) {siblingData.parameters = {}}
            siblingData.parameters.webhookPath = value
            return undefined // Virtual field, don't store directly
          }
        ]
      },
      validate: (value: any, {siblingData}: any) => {
        if (siblingData?.type === 'webhook-trigger' && !value && !siblingData?.parameters?.webhookPath) {
          return 'Webhook path is required for webhook triggers'
        }
        return true
      },
      virtual: true,
    }
  ]
}