// Main export contains only types and client-safe utilities
// Server-side functions are exported via '@xtr-dev/payload-automation/server'

export type {
  ExecutionContext,
  PayloadWorkflow as Workflow,
  ResolvedStep,
  StepResult,
  WorkflowJobMeta
} from './core/workflow-executor.js'

// The shapes triggerCustomWorkflow actually accepts and returns — re-exported
// as type-only so the main entry stays free of server runtime code
export type {
  CustomTriggerOptions,
  TriggerResult
} from './core/trigger-custom-workflow.js'

// Re-export the full plugin config type from server exports
export type { SeedWorkflow, WorkflowsPluginConfig } from './plugin/config-types.js'

// Server-side functions are NOT re-exported here to avoid bundling issues
// Import server-side functions from the /server export instead

// Server functions and plugin should be imported from '/server':
// import { workflowsPlugin } from '@xtr-dev/payload-automation/server'
// UI components should be imported from '/client':
// import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'
