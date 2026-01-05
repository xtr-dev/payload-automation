// Main export contains only types and client-safe utilities
// Server-side functions are exported via '@xtr-dev/payload-automation/server'

export type {
  PayloadWorkflow as Workflow,
  ResolvedStep,
  StepResult,
  WorkflowJobMeta
} from './core/workflow-executor.js'

// Pure types only - completely safe for client bundling
export type {
  CustomTriggerOptions,
  ExecutionContext,
  TriggerResult,
  WorkflowLoggingConfig
} from './types/index.js'

// Re-export the full plugin config type from server exports
export type { WorkflowsPluginConfig } from './plugin/config-types.js'

// Server-side functions are NOT re-exported here to avoid bundling issues
// Import server-side functions from the /server export instead

// Server functions and plugin should be imported from '/server':
// import { workflowsPlugin } from '@xtr-dev/payload-automation/server'
// UI components should be imported from '/client':
// import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'
