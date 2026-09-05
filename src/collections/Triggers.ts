import type { CollectionConfig } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import { normalizeWebhookPath } from '../plugin/webhook-endpoint.js'
import { collectionHookOptions, globalHookOptions } from '../triggers/hook-options.js'
import { refuseIfReferencedByReadOnlyWorkflow } from '../utils/readonly-access.js'

const collectReferencedTriggerIds = (workflow: Record<string, unknown>): (number | string)[] => {
  if (!Array.isArray(workflow.triggers)) {
    return []
  }
  return workflow.triggers
    .map((trigger) => (typeof trigger === 'object' && trigger !== null ? (trigger as { id: number | string }).id : trigger))
    .filter((triggerId): triggerId is number | string => triggerId !== null && triggerId !== undefined)
}

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
      delete: refuseIfReferencedByReadOnlyWorkflow(
        (id) => ({ triggers: { contains: id } }),
        collectReferencedTriggerIds
      ),
      read: () => true,
      update: refuseIfReferencedByReadOnlyWorkflow(
        (id) => ({ triggers: { contains: id } }),
        collectReferencedTriggerIds
      ),
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
          description:
            'Single path segment for this webhook. The endpoint is served at POST /api/automation/webhooks/<path>',
          placeholder: 'my-webhook',
        },
      },
      {
        name: 'webhookSecret',
        type: 'text',
        // The collection's own access (above) is `() => true` for every
        // operation, so without field-level overrides here an anonymous
        // request could both read the secret (GET) and, worse, overwrite it
        // with a value of its own choosing (PATCH { webhookSecret }) without
        // ever needing to read the original — a full bypass of the auth the
        // webhook endpoint enforces. Payload only gates a field's write path
        // when field.access[operation] is explicitly set (it defaults to
        // allowed otherwise), so read and write need independent overrides;
        // fixing read alone still leaves update open. Local API calls (the
        // webhook endpoint's own lookup, and seeding) default overrideAccess
        // to true and skip these checks entirely.
        access: {
          create: ({ req }) => Boolean(req.user),
          read: () => false,
          update: ({ req }) => Boolean(req.user),
        },
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'webhook',
          description:
            'Shared secret the caller must send in the X-Webhook-Secret header (or as an Authorization bearer token). Requests without it are rejected.',
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
            // The runtime endpoint matches paths after stripping leading/trailing
            // slashes (normalizeWebhookPath), so "/my-webhook" and "my-webhook"
            // are the same trigger. Normalize before validating and store the
            // normalized form, rather than rejecting a spelling the endpoint
            // itself accepts.
            if (data?.type === 'webhook' && typeof data.webhookPath === 'string') {
              const normalizedPath = normalizeWebhookPath(data.webhookPath)
              if (!normalizedPath || /[/\s]/.test(normalizedPath)) {
                throw new Error('Webhook path must be a single path segment without whitespace')
              }
              data.webhookPath = normalizedPath
            }
            // Without a secret the endpoint would start workflows for anyone
            // who can reach it, so a webhook trigger cannot be saved open.
            if (data?.type === 'webhook' && !data?.webhookSecret) {
              throw new Error('Webhook secret is required for webhook triggers')
            }
          }
          return data
        }
      ],
    },
  }
}
