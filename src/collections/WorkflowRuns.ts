import type { CollectionConfig } from 'payload'

export const WorkflowRunsCollection: CollectionConfig = {
  slug: 'workflow-runs',
  access: {
    create: () => true,
    delete: () => true,
    read: () => true,
    update: () => true,
  },
  admin: {
    defaultColumns: ['workflow', 'status', 'triggeredBy', 'startedAt', 'duration'],
    group: 'Automation',
    pagination: {
      defaultLimit: 50,
    },
    useAsTitle: 'id',
  },
  fields: [
    {
      name: 'workflow',
      type: 'relationship',
      admin: {
        description: 'Reference to the workflow that was executed',
      },
      relationTo: 'workflows',
      required: true,
    },
    {
      name: 'workflowVersion',
      type: 'number',
      admin: {
        description: 'Version of the workflow that was executed',
      },
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      admin: {
        description: 'Current execution status',
      },
      defaultValue: 'pending',
      options: [
        {
          label: 'Pending',
          value: 'pending',
        },
        {
          label: 'Running',
          value: 'running',
        },
        {
          label: 'Completed',
          value: 'completed',
        },
        {
          label: 'Failed',
          value: 'failed',
        },
        {
          label: 'Cancelled',
          value: 'cancelled',
        },
      ],
      required: true,
    },
    {
      name: 'startedAt',
      type: 'date',
      admin: {
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: 'When execution began',
      },
      required: true,
    },
    {
      name: 'completedAt',
      type: 'date',
      admin: {
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
        description: 'When execution finished',
      },
    },
    {
      name: 'duration',
      type: 'number',
      admin: {
        description: 'Total execution time in milliseconds',
        readOnly: true,
      },
    },
    {
      name: 'context',
      type: 'json'
    },
    {
      name: 'inputs',
      type: 'json',
      admin: {
        description: 'Input data provided when the workflow was triggered',
      },
      defaultValue: {},
      required: true,
    },
    {
      name: 'outputs',
      type: 'json',
      admin: {
        description: 'Final output data from completed steps',
      },
    },
    {
      name: 'triggeredBy',
      type: 'text',
      admin: {
        description: 'User, system, or trigger type that initiated execution',
      },
      required: true,
    },
    {
      name: 'steps',
      type: 'json',
      admin: {
        description: 'Array of step execution results',
      },
      defaultValue: [],
      required: true,
    },
    {
      name: 'error',
      type: 'textarea',
      admin: {
        description: 'Error message if workflow execution failed',
      },
    },
    {
      name: 'logs',
      type: 'json',
      admin: {
        description: 'Detailed execution logs',
      },
      defaultValue: [],
      required: true,
    },
  ],
}
