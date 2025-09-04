import type {CollectionConfig, Field} from 'payload'

import type {WorkflowsPluginConfig} from "../plugin/config-types.js"

export const createWorkflowCollection: <T extends string>(options: WorkflowsPluginConfig<T>) => CollectionConfig = ({
                                                                                                        collectionTriggers,
                                                                                                        steps,
                                                                                                        triggers
                                                                                                      }) => ({
  slug: 'workflows',
  access: {
    create: () => true,
    delete: () => true,
    read: () => true,
    update: () => true,
  },
  admin: {
    defaultColumns: ['name', 'updatedAt'],
    description: 'Create and manage automated workflows.',
    group: 'Automation',
    useAsTitle: 'name',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      admin: {
        description: 'Human-readable name for the workflow',
      },
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Optional description of what this workflow does',
      },
    },
    {
      name: 'executionStatus',
      type: 'ui',
      admin: {
        components: {
          Field: '@/components/WorkflowExecutionStatus'
        },
        condition: (data) => !!data?.id // Only show for existing workflows
      }
    },
    {
      name: 'triggers',
      type: 'array',
      fields: [
        {
          name: 'type',
          type: 'select',
          options: [
            'collection-trigger',
            'webhook-trigger',
            'global-trigger',
            'cron-trigger',
            ...(triggers || []).map(t => t.slug)
          ]
        },
        {
          name: 'collectionSlug',
          type: 'select',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'collection-trigger',
            description: 'Collection that triggers the workflow',
          },
          options: Object.keys(collectionTriggers || {})
        },
        {
          name: 'operation',
          type: 'select',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'collection-trigger',
            description: 'Collection operation that triggers the workflow',
          },
          options: [
            'create',
            'delete',
            'read',
            'update',
          ]
        },
        {
          name: 'webhookPath',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'webhook-trigger',
            description: 'URL path for the webhook (e.g., "my-webhook"). Full URL will be /api/workflows/webhook/my-webhook',
          },
          validate: (value: any, {siblingData}: any) => {
            if (siblingData?.type === 'webhook-trigger' && !value) {
              return 'Webhook path is required for webhook triggers'
            }
            return true
          }
        },
        {
          name: 'global',
          type: 'select',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'global-trigger',
            description: 'Global that triggers the workflow',
          },
          options: [] // Will be populated dynamically based on available globals
        },
        {
          name: 'globalOperation',
          type: 'select',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'global-trigger',
            description: 'Global operation that triggers the workflow',
          },
          options: [
            'update'
          ]
        },
        {
          name: 'cronExpression',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'cron-trigger',
            description: 'Cron expression for scheduled execution (e.g., "0 0 * * *" for daily at midnight)',
            placeholder: '0 0 * * *'
          },
          validate: (value: any, {siblingData}: any) => {
            if (siblingData?.type === 'cron-trigger' && !value) {
              return 'Cron expression is required for cron triggers'
            }

            // Validate cron expression format if provided
            if (siblingData?.type === 'cron-trigger' && value) {
              // Basic format validation - should be 5 parts separated by spaces
              const cronParts = value.trim().split(/\s+/)
              if (cronParts.length !== 5) {
                return 'Invalid cron expression format. Expected 5 parts: "minute hour day month weekday" (e.g., "0 9 * * 1")'
              }

              // Additional validation could use node-cron but we avoid dynamic imports here
              // The main validation happens at runtime in the cron scheduler
            }

            return true
          }
        },
        {
          name: 'timezone',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'cron-trigger',
            description: 'Timezone for cron execution (e.g., "America/New_York", "Europe/London"). Defaults to UTC.',
            placeholder: 'UTC'
          },
          defaultValue: 'UTC',
          validate: (value: any, {siblingData}: any) => {
            if (siblingData?.type === 'cron-trigger' && value) {
              try {
                // Test if timezone is valid by trying to create a date with it
                new Intl.DateTimeFormat('en', {timeZone: value})
                return true
              } catch {
                return `Invalid timezone: ${value}. Please use a valid IANA timezone identifier (e.g., "America/New_York", "Europe/London")`
              }
            }
            return true
          }
        },
        {
          name: 'condition',
          type: 'text',
          admin: {
            description: 'JSONPath expression that must evaluate to true for this trigger to execute the workflow (e.g., "$.doc.status == \'published\'")'
          },
          required: false
        },
        ...(triggers || []).flatMap(t => (t.inputs || []).map(f => ({
          ...f,
          admin: {
            ...(f.admin || {}),
            condition: (...args) => args[1]?.type === t.slug && (
              f.admin?.condition ?
                f.admin.condition.call(this, ...args) :
                true
            ),
          },
        } as Field)))
      ]
    },
    {
      name: 'steps',
      type: 'array',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'step',
              type: 'select',
              options: steps.map(t => t.slug)
            },
            {
              name: 'name',
              type: 'text',
            }
          ]
        },
        ...(steps || []).flatMap(step => (step.inputSchema || []).map(field => ({
          ...field,
          admin: {
            ...(field.admin || {}),
            condition: (...args) => args[1]?.step === step.slug && (
              field.admin?.condition ?
                field.admin.condition.call(this, ...args) :
                true
            ),
          },
        } as Field))),
        {
          name: 'dependencies',
          type: 'text',
          admin: {
            description: 'Step names that must complete before this step can run'
          },
          hasMany: true,
          required: false
        },
        {
          name: 'condition',
          type: 'text',
          admin: {
            description: 'JSONPath expression that must evaluate to true for this step to execute (e.g., "$.trigger.doc.status == \'published\'")'
          },
          required: false
        },
      ],
    }
  ],
  versions: {
    drafts: {
      autosave: false,
    },
    maxPerDoc: 10,
  },
})
