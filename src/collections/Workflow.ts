import type { CollectionConfig } from 'payload'

/**
 * Creates the workflows collection.
 * Workflows reference triggers and steps via relationships for reusability.
 */
export const createWorkflowCollection = (): CollectionConfig => {
  return {
    slug: 'workflows',
    access: {
      create: () => true,
      delete: ({ req, data }) => {
        // Prevent deletion of read-only workflows
        if (data?.readOnly === true) {
          return false
        }
        return true
      },
      read: () => true,
      update: ({ req, data }) => {
        // Prevent updates to read-only workflows
        if (data?.readOnly === true) {
          return false
        }
        return true
      },
    },
    admin: {
      defaultColumns: ['name', 'slug', 'readOnly', 'enabled', 'updatedAt'],
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
        name: 'slug',
        type: 'text',
        admin: {
          description: 'URL-safe unique identifier for this workflow',
          position: 'sidebar',
        },
        index: true,
        unique: true,
      },
      {
        name: 'readOnly',
        type: 'checkbox',
        admin: {
          description: 'Read-only workflows cannot be edited or deleted. This is typically used for seeded template workflows.',
          position: 'sidebar',
          readOnly: true,
        },
        defaultValue: false,
      },
      {
        name: 'readOnlyBanner',
        type: 'ui',
        admin: {
          components: {
            Field: '@xtr-dev/payload-automation/client#ReadOnlyBanner',
          },
          condition: (data) => data?.readOnly === true,
        },
      },
      {
        name: 'description',
        type: 'textarea',
        admin: {
          description: 'Optional description of what this workflow does',
        },
      },
      {
        name: 'enabled',
        type: 'checkbox',
        admin: {
          description: 'Enable or disable this workflow',
          position: 'sidebar',
        },
        defaultValue: true,
      },
      // Triggers - relationship to automation-triggers collection
      {
        name: 'triggers',
        type: 'relationship',
        admin: {
          description: 'Triggers that can start this workflow. Uses OR logic - workflow runs if ANY trigger fires.',
        },
        hasMany: true,
        relationTo: 'automation-triggers',
      },
      // Steps with workflow-specific configuration
      {
        name: 'steps',
        type: 'array',
        admin: {
          description: 'Steps to execute when this workflow runs. Steps execute in order based on dependencies.',
        },
        fields: [
          {
            name: 'step',
            type: 'relationship',
            admin: {
              description: 'Select a step from the step library',
            },
            relationTo: 'automation-steps',
            required: true,
          },
          {
            name: 'stepName',
            type: 'text',
            admin: {
              description: 'Override the step name for this workflow instance (optional)',
            },
          },
          {
            name: 'inputOverrides',
            type: 'json',
            admin: {
              description: 'Override step configuration values for this workflow. Merged with step defaults.',
            },
            defaultValue: {},
          },
          {
            name: 'condition',
            type: 'code',
            admin: {
              description: 'JSONata expression that must evaluate to true for this step to execute. Leave empty to always run. Example: trigger.operation = "create"',
              language: 'javascript',
            },
          },
          {
            name: 'dependencies',
            type: 'array',
            admin: {
              description: 'Steps that must complete before this step can run',
            },
            fields: [
              {
                name: 'stepIndex',
                type: 'number',
                admin: {
                  description: 'Index of the dependent step (0-based)',
                },
                required: true,
              },
            ],
          },
          // Visual builder position
          {
            name: 'position',
            type: 'point',
            admin: {
              description: 'Position in the visual workflow builder',
              hidden: true,
            },
          },
        ],
      },
      // Global workflow settings
      {
        type: 'collapsible',
        label: 'Error Handling',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'errorHandling',
            type: 'select',
            admin: {
              description: 'How to handle step failures',
            },
            defaultValue: 'stop',
            options: [
              { label: 'Stop workflow', value: 'stop' },
              { label: 'Continue to next step', value: 'continue' },
              { label: 'Retry failed step', value: 'retry' },
            ],
          },
          {
            name: 'maxRetries',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.errorHandling === 'retry',
              description: 'Maximum number of retry attempts',
            },
            defaultValue: 3,
          },
          {
            name: 'retryDelay',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.errorHandling === 'retry',
              description: 'Delay between retries in milliseconds',
            },
            defaultValue: 1000,
          },
          {
            name: 'timeout',
            type: 'number',
            admin: {
              description: 'Maximum execution time in milliseconds (0 for no timeout)',
            },
            defaultValue: 300000, // 5 minutes
          },
        ],
      },
    ],
    hooks: {
      afterChange: [
        // Update usage counts for triggers and steps
        async ({ doc, req }) => {
          const payload = req.payload

          // Update trigger usage counts
          if (doc.triggers && Array.isArray(doc.triggers)) {
            for (const triggerId of doc.triggers) {
              const id = typeof triggerId === 'object' ? triggerId.id : triggerId
              if (id) {
                try {
                  // Count workflows using this trigger
                  const count = await payload.count({
                    collection: 'workflows',
                    where: {
                      triggers: { contains: id },
                    },
                  })
                  await payload.update({
                    collection: 'automation-triggers',
                    id,
                    data: { usageCount: count.totalDocs },
                  })
                } catch {
                  // Ignore errors - trigger might have been deleted
                }
              }
            }
          }

          // Update step usage counts
          if (doc.steps && Array.isArray(doc.steps)) {
            const stepIds = new Set<string>()
            for (const workflowStep of doc.steps) {
              const stepId = typeof workflowStep.step === 'object'
                ? workflowStep.step.id
                : workflowStep.step
              if (stepId) stepIds.add(stepId)
            }

            for (const stepId of stepIds) {
              try {
                // Count workflows using this step
                const count = await payload.count({
                  collection: 'workflows',
                  where: {
                    'steps.step': { equals: stepId },
                  },
                })
                await payload.update({
                  collection: 'automation-steps',
                  id: stepId,
                  data: { usageCount: count.totalDocs },
                })
              } catch {
                // Ignore errors - step might have been deleted
              }
            }
          }

          return doc
        },
      ],
    },
    versions: {
      drafts: {
        autosave: false,
      },
      maxPerDoc: 10,
    },
  }
}
