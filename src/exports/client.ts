// Client-side components that may have CSS imports or PayloadCMS UI dependencies
// These are separated to avoid CSS import errors during Node.js type generation

export { TriggerWorkflowButton } from '../components/TriggerWorkflowButton.js'
export { StatusCell } from '../components/StatusCell.js'
export { ErrorDisplay } from '../components/ErrorDisplay.js'
export { WorkflowExecutionStatus } from '../components/WorkflowExecutionStatus.js'

// Future client components can be added here:
// export { default as WorkflowDashboard } from '../components/WorkflowDashboard/index.js'
// export { default as WorkflowBuilder } from '../components/WorkflowBuilder/index.js'
