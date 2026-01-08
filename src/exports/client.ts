// Client-side components that may have CSS imports or PayloadCMS UI dependencies
// These are separated to avoid CSS import errors during Node.js type generation

export { StatusCell } from '../components/StatusCell.js'
export { ErrorDisplay } from '../components/ErrorDisplay.js'
export { ReadOnlyBanner } from '../components/ReadOnlyBanner.js'

// Future client components can be added here:
// export { default as WorkflowDashboard } from '../components/WorkflowDashboard/index.js'
// export { default as WorkflowBuilder } from '../components/WorkflowBuilder/index.js'
