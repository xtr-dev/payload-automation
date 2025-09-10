import type {TriggerConfig} from '../plugin/config-types.js'

export const webhookTrigger: TriggerConfig = () => ({
  slug: 'webhook',
  fields: [
    {
      name: 'webhookPath',
      type: 'text',
      admin: {
        description: 'URL path for the webhook (e.g., "my-webhook"). Full URL will be /api/workflows-webhook/my-webhook',
      },
      validate: (value: any, {siblingData}: any) => {
        if (siblingData?.type === 'webhook' && !value && !siblingData?.parameters?.webhookPath) {
          return 'Webhook path is required for webhook triggers'
        }
        return true
      },
    }
  ]
})