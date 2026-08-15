// Pure type definitions for client-safe exports
// This file contains NO runtime code and can be safely bundled

export interface CustomTriggerOptions {
  /** Data to pass to the workflow execution context. */
  data?: Record<string, unknown>
  /** PayloadRequest, kept as `any` so this client-safe entry does not import Payload. */
  req?: any
  /** The slug of the custom trigger to execute. */
  slug: string
  /** Optional user information for tracking who triggered the workflow. */
  user?: {
    email?: string
    id?: string
  }
}

export interface TriggerResult {
  error?: string
  runId: number | string
  status: 'failed' | 'triggered'
  workflowId: string
  workflowName: string
}

export interface ExecutionContext {
  steps: Record<string, any>
  trigger: Record<string, any>
}

// NOTE: Workflow, WorkflowStep, and WorkflowTrigger types are now imported from the generated PayloadCMS types
// These interfaces have been removed to avoid duplication and inconsistencies
// Import them from 'payload' or the generated payload-types.ts file instead

export type { WorkflowsPluginConfig, SeedWorkflow } from '../plugin/config-types.js'

/**
 * Logging configuration options for the workflows plugin.
 * @deprecated Set `enabled` with WorkflowsPluginConfig. Configure log level with
 * the PAYLOAD_AUTOMATION_LOG_LEVEL environment variable; WorkflowsPluginConfig
 * does not provide a `level` option.
 */
export interface WorkflowLoggingConfig {
    level?: 'debug' | 'info' | 'warn' | 'error'
    enabled?: boolean
}
