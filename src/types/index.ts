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

export interface WorkflowStep {
  id: string
  type: string
  input: Record<string, any>
  dependencies?: string[]
}

export interface WorkflowTrigger {
  type: 'collection' | 'global' | 'webhook' | 'cron' | 'manual'
  collection?: string
  global?: string
  event?: 'create' | 'update' | 'delete' | 'read'
  path?: string
  cron?: string
}

export interface Workflow {
  id: string
  name: string
  description?: string
  active: boolean
  triggers: WorkflowTrigger[]
  steps: WorkflowStep[]
}

export interface WorkflowsPluginConfig {
  collections?: string[]
  globals?: string[]
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error'
    enabled?: boolean
  }
}