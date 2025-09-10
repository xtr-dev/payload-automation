import type {CollectionConfig, Field} from 'payload'

import type {WorkflowsPluginConfig} from "../plugin/config-types.js"

export const createWorkflowCollection: <T extends string>(options: WorkflowsPluginConfig<T>) => CollectionConfig = (options) => {
  const {steps} = options
  const triggers = (options.triggers || []).map(t => t(options))
  return {
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
            Field: '@xtr-dev/payload-automation/client#WorkflowExecutionStatus'
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
              ...(triggers || []).map(t => t.slug)
            ]
          },
          {
            name: 'parameters',
            type: 'json',
            admin: {
              hidden: true,
            },
            defaultValue: {}
          },
          {
            name: 'condition',
            type: 'text',
            admin: {
              description: 'JSONPath expression that must evaluate to true for this trigger to execute the workflow (e.g., "$.trigger.doc.status == \'published\'")'
            },
            required: false
          },
          // Virtual fields for custom triggers
          ...(triggers || []).flatMap(t => (t.fields || []))
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
          ...(steps || []).flatMap(step => (step.inputSchema || []).map(field => {
            const originalName = (field as any).name;
            const resultField: any = {
              ...field,
              // Prefix field name with step slug to avoid conflicts
              name: `__step_${step.slug}_${originalName}`,
              admin: {
                ...(field.admin || {}),
                condition: (...args: any[]) => args[1]?.step === step.slug && (
                  (field.admin as any)?.condition ?
                    (field.admin as any).condition.call(this, ...args) :
                    true
                ),
              },
              virtual: true,
            };

            // Add hooks to store/retrieve from the step's input data
            resultField.hooks = {
              ...((field as any).hooks || {}),
              afterRead: [
                ...(((field as any).hooks)?.afterRead || []),
                ({ siblingData }: any) => {
                  // Read from step input data using original field name
                  return siblingData?.[originalName] || (field as any).defaultValue;
                }
              ],
              beforeChange: [
                ...(((field as any).hooks)?.beforeChange || []),
                ({ siblingData, value }: any) => {
                  // Store in step data using original field name
                  siblingData[originalName] = value;
                  return undefined; // Don't store the prefixed field
                }
              ]
            };

            return resultField as Field;
          })),
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
  }
}
