// Main export contains only types and client-safe utilities
// Server-side functions are exported via '@xtr-dev/payload-automation/server'

// Pure types only - completely safe for client bundling
export type {
  CustomTriggerOptions,
  TriggerResult,
  ExecutionContext,
  Workflow,
  WorkflowStep,
  WorkflowTrigger,
  WorkflowsPluginConfig
} from './types/index.js'

// Server-side functions are NOT re-exported here to avoid bundling issues
// Import server-side functions from the /server export instead

// Server functions and plugin should be imported from '/server':
// import { workflowsPlugin } from '@xtr-dev/payload-automation/server'
// UI components should be imported from '/client':
// import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'
