// Pure type definitions for client-safe exports
// This file contains NO runtime code and can be safely bundled

export interface CustomTriggerOptions {
  workflowId: string
  triggerData?: any
  req?: any // PayloadRequest type, but avoiding import to keep this client-safe
}

export interface TriggerResult {
  success: boolean
  runId?: string
  error?: string
}

export interface ExecutionContext {
  trigger: {
    type: string
    doc?: any
    data?: any
  }
  steps: Record<string, {
    output?: any
    state: 'pending' | 'running' | 'succeeded' | 'failed'
  }>
  payload: any // Payload instance
  req: any // PayloadRequest
}

// NOTE: Workflow, WorkflowStep, and WorkflowTrigger types are now imported from the generated PayloadCMS types
// These interfaces have been removed to avoid duplication and inconsistencies
// Import them from 'payload' or the generated payload-types.ts file instead

export type { WorkflowsPluginConfig, SeedWorkflow } from '../plugin/config-types.js'

/**
 * Logging configuration options for the workflows plugin.
 * @deprecated Use the full WorkflowsPluginConfig from '@xtr-dev/payload-automation/server' instead.
 */
export interface WorkflowLoggingConfig {
    level?: 'debug' | 'info' | 'warn' | 'error'
    enabled?: boolean
}