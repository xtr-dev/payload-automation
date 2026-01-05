import type { CollectionConfig, TaskConfig } from 'payload'

/**
 * Creates the automation-steps collection.
 * Steps are reusable building blocks that can be used across multiple workflows.
 */
export const createStepsCollection = (
  steps: TaskConfig<string>[]
): CollectionConfig => {
  // Build step type options from registered steps
  const stepTypeOptions = steps.map(step => ({
    label: step.label || step.slug,
    value: step.slug,
  }))

  return {
    slug: 'automation-steps',
    access: {
      create: () => true,
      delete: () => true,
      read: () => true,
      update: () => true,
    },
    admin: {
      defaultColumns: ['name', 'type', 'updatedAt'],
      description: 'Reusable step templates that can be used across workflows.',
      group: 'Automation',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        admin: {
          description: 'Human-readable name for this step',
        },
        required: true,
      },
      {
        name: 'description',
        type: 'textarea',
        admin: {
          description: 'Optional description of what this step does',
        },
      },
      {
        name: 'type',
        type: 'select',
        admin: {
          description: 'The type of action this step performs',
        },
        options: stepTypeOptions,
        required: true,
      },
      // Step configuration
      {
        type: 'collapsible',
        label: 'Configuration',
        admin: {
          initCollapsed: false,
        },
        fields: [
          {
            name: 'config',
            type: 'json',
            admin: {
              description: 'Step configuration in JSON format. String values can use JSONata expressions for dynamic data (e.g., "trigger.doc.id")',
            },
            defaultValue: {},
          },
        ],
      },
      // Visual properties for workflow builder
      {
        type: 'collapsible',
        label: 'Appearance',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'color',
            type: 'text',
            admin: {
              description: 'Color for the step node in the visual builder (hex code)',
              placeholder: '#3b82f6',
            },
            defaultValue: '#3b82f6',
          },
          {
            name: 'icon',
            type: 'text',
            admin: {
              description: 'Icon name for the step (optional)',
            },
          },
        ],
      },
      // Input validation schema (optional)
      {
        type: 'collapsible',
        label: 'Advanced',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'inputValidation',
            type: 'json',
            admin: {
              description: 'Optional JSON schema for validating step inputs',
            },
          },
          {
            name: 'retryOnFailure',
            type: 'checkbox',
            admin: {
              description: 'Retry this step if it fails',
            },
            defaultValue: false,
          },
          {
            name: 'maxRetries',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.retryOnFailure === true,
              description: 'Maximum number of retry attempts',
            },
            defaultValue: 3,
          },
          {
            name: 'retryDelay',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.retryOnFailure === true,
              description: 'Delay between retries in milliseconds',
            },
            defaultValue: 1000,
          },
        ],
      },
      // Usage tracking
      {
        name: 'usageCount',
        type: 'number',
        admin: {
          description: 'Number of workflows using this step',
          readOnly: true,
          position: 'sidebar',
        },
        defaultValue: 0,
      },
    ],
    hooks: {
      beforeChange: [
        // Validate that type is selected
        async ({ data, operation }) => {
          if ((operation === 'create' || operation === 'update') && !data?.type) {
            throw new Error('Step type is required')
          }
          return data
        }
      ],
    },
  }
}
