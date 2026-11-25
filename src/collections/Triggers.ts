import type { CollectionConfig } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import { adminUserAccess, resolveCollectionAccess } from './access.js'
import { collectionHookOptions, globalHookOptions } from '../triggers/hook-options.js'
import { refuseIfReferencedByReadOnlyWorkflow } from '../utils/readonly-access.js'
import { hashWebhookSecret, normalizeWebhookPath } from '../utils/webhook.js'

const collectReferencedTriggerIds = (workflow: Record<string, unknown>): (number | string)[] => {
  if (!Array.isArray(workflow.triggers)) {
    return []
  }
  return workflow.triggers
    .map((trigger) => (typeof trigger === 'object' && trigger !== null ? (trigger as { id: number | string }).id : trigger))
    .filter((triggerId): triggerId is number | string => triggerId !== null && triggerId !== undefined)
}

const readOnlyReferenceLock = refuseIfReferencedByReadOnlyWorkflow(
  (id) => ({ triggers: { contains: id } }),
  collectReferencedTriggerIds
)

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
    access: resolveCollectionAccess(
      options,
      'automation-triggers',
      {
        create: adminUserAccess,
        delete: adminUserAccess,
        read: adminUserAccess,
        // This collection has no versions or drafts; readVersions is set so
        // enabling them later does not fall back to Payload's default of
        // "any logged-in user". unlock releases another user's edit lock.
        readVersions: adminUserAccess,
        unlock: adminUserAccess,
        update: adminUserAccess,
      },
      {
        // Applied on top of the defaults and any `access` override: a
        // document a read-only workflow references stays locked.
        delete: readOnlyReferenceLock,
        update: readOnlyReferenceLock,
      },
    ),
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
        // Write-only input for the webhook secret. It is a virtual field, so
        // nothing is stored under this name: the beforeChange hook below
        // hashes a submitted value into webhookSecretHash. Reads therefore
        // never return the secret, while the field stays readable as far as
        // field access goes, which Payload's admin UI needs to render it (it
        // omits fields the user cannot read). Who may set it is decided by
        // the collection's access: admin users by default.
        name: 'webhookSecret',
        type: 'text',
        admin: {
          condition: (_, siblingData) => siblingData?.type === 'webhook',
          description:
            'Shared secret the caller must send in the X-Webhook-Secret header (or as an Authorization bearer token). Only a hash is stored: the secret is never shown again after saving. Leave empty to keep the current secret; enter a new one to rotate it.',
        },
        hooks: {
          // Guards against a value lingering on the document returned by a
          // create or update operation.
          afterRead: [() => null],
        },
        virtual: true,
      },
      {
        // SHA-256 of the webhook secret, compared timing-safe by the webhook
        // endpoint. Hidden fields are left out of API responses and the admin
        // UI. Field access refuses client-supplied values on create and
        // update, so the hash can only come from the beforeChange hook (or a
        // Local API call with overrideAccess, such as seeding).
        name: 'webhookSecretHash',
        type: 'text',
        access: {
          create: () => false,
          update: () => false,
        },
        hidden: true,
        index: true,
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
        async ({ data, operation, originalDoc }) => {
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
            // Store only the hash of a submitted secret. An empty or missing
            // value keeps the current hash, so saving the admin form without
            // retyping the secret does not clear it. The check runs whatever
            // the submitted type, so a partial update that only sends a new
            // secret still rotates it.
            if (typeof data?.webhookSecret === 'string' && data.webhookSecret.length > 0) {
              data.webhookSecretHash = hashWebhookSecret(data.webhookSecret)
            }
            if (data) {
              delete data.webhookSecret
            }
            // Without a secret the endpoint would start workflows for anyone
            // who can reach it, so a webhook trigger cannot be saved open.
            const type = data?.type ?? originalDoc?.type
            if (type === 'webhook' && !(data?.webhookSecretHash ?? originalDoc?.webhookSecretHash)) {
              throw new Error('Webhook secret is required for webhook triggers')
            }
          }
          return data
        }
      ],
    },
  }
}
