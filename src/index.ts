export { triggerCustomWorkflow, triggerWorkflowById } from './core/trigger-custom-workflow.js'
export type { CustomTriggerOptions, TriggerResult } from './core/trigger-custom-workflow.js'
export { WorkflowExecutor } from './core/workflow-executor.js'
export type { ExecutionContext, Workflow, WorkflowStep, WorkflowTrigger } from './core/workflow-executor.js'
export type { WorkflowsPluginConfig } from './plugin/config-types.js'
export { workflowsPlugin } from './plugin/index.js'

// Export all step tasks
export {
  CreateDocumentStepTask,
  DeleteDocumentStepTask,
  HttpRequestStepTask,
  ReadDocumentStepTask,
  SendEmailStepTask,
  UpdateDocumentStepTask
} from './steps/index.js'

// UI components are exported via separate client export to avoid CSS import issues during type generation
// Use: import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'
