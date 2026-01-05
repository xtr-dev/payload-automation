import type { CollectionConfig } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import { collectionHookOptions, globalHookOptions } from '../triggers/hook-options.js'

/**
 * Creates the automation-triggers collection.
 * Triggers are reusable and can be shared across multiple workflows.
 */
export const createTriggersCollection = <T extends string>(
  options: WorkflowsPluginConfig<T>
): CollectionConfig => {
  const collectionSlugs = Object.keys(options.collectionTriggers || {})
  const globalSlugs = Object.keys(options.globalTriggers || {})

  return {
    slug: 'automation-triggers',
    access: {
      create: () => true,
      delete: () => true,
      read: () => true,
      update: () => true,
    },
    admin: {
      defaultColumns: ['name', 'type', 'target', 'updatedAt'],
      description: 'Reusable trigger definitions that can be shared across workflows.',
      group: 'Automation',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        admin: {
          description: 'Human-readable name for this trigger',
        },
        required: true,
      },
      {
        name: 'description',
        type: 'textarea',
        admin: {
          description: 'Optional description of when this trigger fires',
        },
      },
      {
        name: 'type',
        type: 'select',
        admin: {
          description: 'The type of event that will fire this trigger',
        },
        defaultValue: 'collection-hook',
        options: [
          { label: 'Collection Hook', value: 'collection-hook' },
          { label: 'Global Hook', value: 'global-hook' },
          { label: 'Scheduled (Cron)', value: 'scheduled' },
          { label: 'Webhook', value: 'webhook' },
          { label: 'Manual', value: 'manual' },
        ],
        required: true,
      },
      // Virtual field to show human-readable target
      {
        name: 'target',
        type: 'text',
        admin: {
          readOnly: true,
          description: 'The target of this trigger',
        },
        hooks: {
          beforeChange: [
            ({ siblingData }) => {
              // Compute target based on type
              if (siblingData.type === 'collection-hook') {
                return `${siblingData.collectionSlug}.${siblingData.hook}`
              } else if (siblingData.type === 'global-hook') {
                return `${siblingData.globalSlug}.${siblingData.hook}`
              } else if (siblingData.type === 'scheduled') {
                return siblingData.schedule || 'Not configured'
              } else if (siblingData.type === 'webhook') {
                return siblingData.webhookPath || 'Not configured'
              }
              return 'Manual trigger'
            }
          ]
        }
      },
      // Collection Hook fields
      {
        name: 'collectionSlug',
        type: 'select',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'collection-hook',
          description: 'The collection to watch for events',
        },
        options: collectionSlugs.map(slug => ({ label: slug, value: slug })),
      },
      {
        name: 'hook',
        type: 'select',
        admin: {
          condition: (_, siblingData) =>
            siblingData?.type === 'collection-hook' || siblingData?.type === 'global-hook',
          description: 'The specific hook event to listen for',
        },
        options: collectionHookOptions.map(opt => ({ label: opt.label, value: opt.value })),
      },
      // Global Hook fields
      {
        name: 'globalSlug',
        type: 'select',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'global-hook',
          description: 'The global to watch for events',
        },
        options: globalSlugs.map(slug => ({ label: slug, value: slug })),
      },
      // Scheduled fields
      {
        name: 'schedule',
        type: 'text',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'scheduled',
          description: 'Cron expression (e.g., "0 9 * * *" for 9 AM daily)',
          placeholder: '0 9 * * *',
        },
      },
      // Webhook fields
      {
        name: 'webhookPath',
        type: 'text',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'webhook',
          description: 'The URL path for this webhook (e.g., "my-webhook")',
          placeholder: 'my-webhook',
        },
      },
      // Condition configuration
      {
        type: 'collapsible',
        label: 'Condition',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'condition',
            type: 'code',
            admin: {
              description: 'JSONata expression that must evaluate to true for this trigger to fire. Leave empty to always fire. Example: trigger.doc._status = "published"',
              language: 'javascript',
            },
          },
          {
            name: 'conditionDescription',
            type: 'text',
            admin: {
              description: 'Human-readable explanation of the condition (for documentation)',
              placeholder: 'e.g., "Only when status is published"',
            },
          },
        ],
      },
      // Usage tracking
      {
        name: 'usageCount',
        type: 'number',
        admin: {
          description: 'Number of workflows using this trigger',
          readOnly: true,
          position: 'sidebar',
        },
        defaultValue: 0,
      },
    ],
    hooks: {
      beforeChange: [
        // Validate required fields based on type
        async ({ data, operation }) => {
          if (operation === 'create' || operation === 'update') {
            if (data?.type === 'collection-hook' && !data?.collectionSlug) {
              throw new Error('Collection is required for collection hook triggers')
            }
            if (data?.type === 'global-hook' && !data?.globalSlug) {
              throw new Error('Global is required for global hook triggers')
            }
            if ((data?.type === 'collection-hook' || data?.type === 'global-hook') && !data?.hook) {
              throw new Error('Hook type is required')
            }
            if (data?.type === 'scheduled' && !data?.schedule) {
              throw new Error('Schedule is required for scheduled triggers')
            }
            if (data?.type === 'webhook' && !data?.webhookPath) {
              throw new Error('Webhook path is required for webhook triggers')
            }
          }
          return data
        }
      ],
    },
  }
}
