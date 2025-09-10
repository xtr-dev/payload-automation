import type {CollectionConfig} from 'payload'

import type {WorkflowsPluginConfig} from "../plugin/config-types.js"

import {parameter} from "../fields/parameter.js"
import {collectionHookTrigger} from "../triggers/index.js"

export const createWorkflowCollection: <T extends string>(options: WorkflowsPluginConfig<T>) => CollectionConfig = (options) => {
  const steps = options.steps || []
  const triggers = (options.triggers || []).map(t => t(options)).concat(collectionHookTrigger(options))
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
            name: 'parameters',
            type: 'json',
            admin: {
              hidden: true,
            },
            defaultValue: {}
          },
          // Virtual fields for custom triggers
          ...steps.flatMap(step => (step.inputSchema || []).map(s => parameter(step.slug, s as any))),
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
