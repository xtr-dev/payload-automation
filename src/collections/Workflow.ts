import type {CollectionConfig} from 'payload'

import type {WorkflowsPluginConfig} from "../plugin/config-types.js"

import {parameter} from "../fields/parameter.js"
import {collectionTrigger, globalTrigger} from "../triggers/index.js"

export const createWorkflowCollection: <T extends string>(options: WorkflowsPluginConfig<T>) => CollectionConfig = (options) => {
  const steps = options.steps || []
  const triggers = (options.triggers || []).map(t => t(options)).concat(collectionTrigger(options), globalTrigger(options))
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
      defaultColumns: ['name', 'slug', 'readOnly', 'updatedAt'],
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
        name: 'triggers',
        type: 'array',
        fields: [
          {
            name: 'type',
            type: 'select',
            options: [
              ...triggers.map(t => t.slug)
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
          // Virtual fields for custom triggers
          ...triggers.flatMap(t => (t.parameters || []).map(p => parameter(t.slug, p as any))),
          {
            name: 'condition',
            type: 'text',
            admin: {
              description: 'JSONPath expression that must evaluate to true for this trigger to execute the workflow (e.g., "$.trigger.doc.status == \'published\'")'
            },
            required: false
          },
        ]
      },
      {
        name: 'steps',
        type: 'array',
        fields: [
          {
            name: 'name',
            type: 'text',
            defaultValue: 'Unnamed Step'
          },
          {
            name: 'type',
            type: 'select',
            options: steps.map(t => t.slug)
          },
          {
            name: 'input',
            type: 'json',
            admin: {
              description: 'Step input configuration. Use JSONPath expressions to reference dynamic data (e.g., {"url": "$.trigger.doc.webhookUrl", "data": "$.steps.previousStep.output.result"})'
            },
            defaultValue: {}
          },
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
