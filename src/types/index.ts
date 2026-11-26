// Pure type definitions for client-safe exports
// This file contains NO runtime code and can be safely bundled

// CustomTriggerOptions, ExecutionContext and TriggerResult used to be redefined
// here from scratch, independently of the shapes core/trigger-custom-workflow.ts
// and core/workflow-executor.ts actually produce and accept. The copies drifted
// (e.g. TriggerResult.success vs the real status: 'failed'|'triggered'), so the
// published types described data the runtime never returns. src/index.ts now
// re-exports the real types directly instead of duplicating them here.

// NOTE: Workflow, WorkflowStep, and WorkflowTrigger types are now imported from the generated PayloadCMS types
// These interfaces have been removed to avoid duplication and inconsistencies
// Import them from 'payload' or the generated payload-types.ts file instead

export type { WorkflowsPluginConfig, SeedWorkflow } from '../plugin/config-types.js'
