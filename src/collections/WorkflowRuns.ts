import type { CollectionConfig } from 'payload'

/**
 * WorkflowRuns collection for tracking workflow executions.
 * Enhanced with structured step results and trigger tracking.
 */
export const WorkflowRunsCollection: CollectionConfig = {
  slug: 'workflow-runs',
  access: {
    create: () => true,
    delete: () => true,
    read: () => true,
    update: () => true,
  },
  admin: {
    defaultColumns: ['workflow', 'status', 'firedTrigger', 'startedAt', 'duration'],
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
    },
    // Track which trigger fired
    {
      name: 'firedTrigger',
      type: 'relationship',
      admin: {
        description: 'The trigger that initiated this workflow run',
      },
      relationTo: 'automation-triggers',
    },
    {
      name: 'triggerData',
      type: 'json',
      admin: {
        description: 'Snapshot of the trigger context when the workflow was fired',
      },
    },
    // Status and timing
    {
      name: 'status',
      type: 'select',
      admin: {
        description: 'Current execution status',
        components: {
          Cell: '@xtr-dev/payload-automation/client#StatusCell'
        }
      },
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Running', value: 'running' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
        { label: 'Cancelled', value: 'cancelled' },
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
    // Structured step results
    {
      name: 'stepResults',
      type: 'array',
      admin: {
        description: 'Detailed results for each step execution',
      },
      fields: [
        {
          name: 'step',
          type: 'relationship',
          admin: {
            description: 'Reference to the step that was executed',
          },
          relationTo: 'automation-steps',
        },
        {
          name: 'stepName',
          type: 'text',
          admin: {
            description: 'Name of the step at execution time',
          },
        },
        {
          name: 'stepIndex',
          type: 'number',
          admin: {
            description: 'Position of the step in the workflow',
          },
        },
        {
          name: 'status',
          type: 'select',
          admin: {
            description: 'Step execution status',
          },
          options: [
            { label: 'Pending', value: 'pending' },
            { label: 'Running', value: 'running' },
            { label: 'Succeeded', value: 'succeeded' },
            { label: 'Failed', value: 'failed' },
            { label: 'Skipped', value: 'skipped' },
          ],
        },
        {
          name: 'startedAt',
          type: 'date',
          admin: {
            date: {
              displayFormat: 'yyyy-MM-dd HH:mm:ss',
            },
            description: 'When this step started',
          },
        },
        {
          name: 'completedAt',
          type: 'date',
          admin: {
            date: {
              displayFormat: 'yyyy-MM-dd HH:mm:ss',
            },
            description: 'When this step completed',
          },
        },
        {
          name: 'duration',
          type: 'number',
          admin: {
            description: 'Step execution time in milliseconds',
          },
        },
        {
          name: 'input',
          type: 'json',
          admin: {
            description: 'Input data passed to this step (after template resolution)',
          },
        },
        {
          name: 'output',
          type: 'json',
          admin: {
            description: 'Output data returned by this step',
          },
        },
        {
          name: 'error',
          type: 'textarea',
          admin: {
            description: 'Error message if this step failed',
          },
        },
        {
          name: 'retryCount',
          type: 'number',
          admin: {
            description: 'Number of retry attempts for this step',
          },
          defaultValue: 0,
        },
      ],
    },
    // Execution context
    {
      name: 'context',
      type: 'json',
      admin: {
        description: 'Full execution context including trigger data and step outputs',
      },
    },
    {
      name: 'inputs',
      type: 'json',
      admin: {
        description: 'Input data provided when the workflow was triggered',
      },
      defaultValue: {},
    },
    {
      name: 'outputs',
      type: 'json',
      admin: {
        description: 'Final output data from completed steps',
      },
    },
    // Metadata
    {
      name: 'triggeredBy',
      type: 'text',
      admin: {
        description: 'User, system, or trigger type that initiated execution',
      },
      required: true,
    },
    // Error information
    {
      name: 'error',
      type: 'textarea',
      admin: {
        description: 'Error message if workflow execution failed',
        condition: (_, siblingData) => siblingData?.status === 'failed',
        components: {
          Field: '@xtr-dev/payload-automation/client#ErrorDisplay'
        }
      },
    },
    // Structured logs
    {
      name: 'logs',
      type: 'array',
      admin: {
        description: 'Detailed execution logs',
      },
      fields: [
        {
          name: 'timestamp',
          type: 'date',
          admin: {
            date: {
              displayFormat: 'yyyy-MM-dd HH:mm:ss.SSS',
            },
          },
        },
        {
          name: 'level',
          type: 'select',
          options: [
            { label: 'Debug', value: 'debug' },
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warn' },
            { label: 'Error', value: 'error' },
          ],
        },
        {
          name: 'message',
          type: 'text',
        },
        {
          name: 'stepIndex',
          type: 'number',
          admin: {
            description: 'Index of the step that generated this log (optional)',
          },
        },
        {
          name: 'data',
          type: 'json',
          admin: {
            description: 'Additional data for this log entry',
          },
        },
      ],
    },
  ],
  hooks: {
    beforeChange: [
      // Calculate duration when completedAt is set
      async ({ data }) => {
        if (data?.completedAt && data?.startedAt) {
          const started = new Date(data.startedAt).getTime()
          const completed = new Date(data.completedAt).getTime()
          data.duration = completed - started
        }
        return data
      }
    ],
  },
}
