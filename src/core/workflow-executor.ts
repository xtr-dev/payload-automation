import type { Payload, PayloadRequest } from 'payload'

import {
  evaluateCondition as evalCondition,
  resolveStepInput as resolveInput,
  type ExpressionContext
} from './expression-engine.js'

/**
 * Type for workflow data from the refactored collection
 */
export type PayloadWorkflow = {
  id: number | string
  name: string
  description?: string | null
  enabled?: boolean
  triggers?: Array<any> | null
  steps?: Array<{
    id?: string
    step: any
    stepName?: string | null
    inputOverrides?: Record<string, unknown> | null
    condition?: string | null
    dependencies?: Array<{ stepIndex: number }> | null
    position?: { x: number; y: number } | null
  }> | null
  errorHandling?: 'stop' | 'continue' | 'retry' | null
  maxRetries?: number | null
  retryDelay?: number | null
  timeout?: number | null
  [key: string]: unknown
}

/**
 * Type for a resolved workflow step (with base step data merged)
 */
export type ResolvedStep = {
  stepIndex: number
  stepId: string | number
  stepName: string
  stepType: string
  config: Record<string, unknown>
  condition?: string | null
  dependencies: number[]
  retryOnFailure?: boolean
  maxRetries?: number
  retryDelay?: number
}

export interface ExecutionContext {
  steps: Record<string, any>
  trigger: Record<string, any>
}

export interface StepResult {
  step?: string | number
  stepName: string
  stepIndex: number
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  startedAt?: string
  completedAt?: string
  duration?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  retryCount?: number
}

/**
 * Workflow context stored on jobs created by workflow execution.
 * Uses relationship IDs that link to the respective collections.
 */
export interface WorkflowJobMeta {
  automationWorkflowId: string | number
  automationWorkflowRunId: string | number
  automationTriggerId?: string | number
}

export class WorkflowExecutor {
  constructor(
    private payload: Payload,
    private logger: Payload['logger']
  ) {}

  /**
   * Resolve workflow steps by loading base step configurations and merging with overrides
   */
  private async resolveWorkflowSteps(workflow: PayloadWorkflow): Promise<ResolvedStep[]> {
    const resolvedSteps: ResolvedStep[] = []

    if (!workflow.steps || workflow.steps.length === 0) {
      return resolvedSteps
    }

    for (let i = 0; i < workflow.steps.length; i++) {
      const workflowStep = workflow.steps[i]

      let baseStep: any
      if (typeof workflowStep.step === 'object' && workflowStep.step !== null) {
        baseStep = workflowStep.step
      } else {
        try {
          baseStep = await this.payload.findByID({
            collection: 'automation-steps',
            id: workflowStep.step,
            depth: 0
          })
        } catch (error) {
          this.logger.error({
            stepId: workflowStep.step,
            stepIndex: i,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Failed to load step configuration')
          throw new Error(`Failed to load step ${workflowStep.step}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      const baseConfig = (baseStep.config as Record<string, unknown>) || {}
      const overrides = (workflowStep.inputOverrides as Record<string, unknown>) || {}
      const mergedConfig = { ...baseConfig, ...overrides }

      const dependencies = (workflowStep.dependencies || []).map(d => d.stepIndex)

      resolvedSteps.push({
        stepIndex: i,
        stepId: baseStep.id,
        stepName: workflowStep.stepName || baseStep.name || `step-${i}`,
        stepType: baseStep.type as string,
        config: mergedConfig,
        condition: workflowStep.condition,
        dependencies,
        retryOnFailure: baseStep.retryOnFailure,
        maxRetries: baseStep.maxRetries || workflow.maxRetries || 3,
        retryDelay: baseStep.retryDelay || workflow.retryDelay || 1000
      })
    }

    return resolvedSteps
  }

  /**
   * Resolve step execution order based on dependencies
   */
  private resolveExecutionOrder(steps: ResolvedStep[]): ResolvedStep[][] {
    const indegree = new Map<number, number>()
    const dependents = new Map<number, number[]>()

    for (const step of steps) {
      indegree.set(step.stepIndex, step.dependencies.length)
      dependents.set(step.stepIndex, [])
    }

    for (const step of steps) {
      for (const depIndex of step.dependencies) {
        const deps = dependents.get(depIndex) || []
        deps.push(step.stepIndex)
        dependents.set(depIndex, deps)
      }
    }

    const executionBatches: ResolvedStep[][] = []
    const processed = new Set<number>()

    while (processed.size < steps.length) {
      const currentBatch: ResolvedStep[] = []

      for (const step of steps) {
        if (!processed.has(step.stepIndex) && indegree.get(step.stepIndex) === 0) {
          currentBatch.push(step)
        }
      }

      if (currentBatch.length === 0) {
        throw new Error('Circular dependency detected in workflow steps')
      }

      executionBatches.push(currentBatch)

      for (const step of currentBatch) {
        processed.add(step.stepIndex)
        for (const depIndex of dependents.get(step.stepIndex) || []) {
          indegree.set(depIndex, (indegree.get(depIndex) || 1) - 1)
        }
      }
    }

    return executionBatches
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: ResolvedStep,
    context: ExecutionContext,
    req: PayloadRequest,
    stepResults: StepResult[],
    jobMeta: WorkflowJobMeta
  ): Promise<StepResult> {
    const result: StepResult = {
      step: step.stepId,
      stepName: step.stepName,
      stepIndex: step.stepIndex,
      status: 'running',
      startedAt: new Date().toISOString(),
      retryCount: 0
    }

    this.logger.info({
      stepName: step.stepName,
      stepType: step.stepType,
      stepIndex: step.stepIndex
    }, 'Executing step')

    // Check step condition if present
    if (step.condition) {
      const conditionMet = await this.evaluateCondition(step.condition, context)
      if (!conditionMet) {
        this.logger.info({
          stepName: step.stepName,
          condition: step.condition
        }, 'Step condition not met, skipping')

        result.status = 'skipped'
        result.completedAt = new Date().toISOString()
        result.output = { reason: 'Condition not met', skipped: true }

        context.steps[step.stepName] = {
          state: 'skipped',
          output: result.output
        }

        return result
      }
    }

    // Resolve input using JSONata expressions
    const resolvedInput = await this.resolveStepInput(step.config, context)
    result.input = resolvedInput

    context.steps[step.stepName] = {
      state: 'running',
      input: resolvedInput
    }

    try {
      const job = await this.payload.jobs.queue({
        input: resolvedInput,
        req,
        task: step.stepType,
      })

      // Update the job with automation context fields
      // This allows tracking which workflow run triggered this job
      await this.payload.update({
        collection: 'payload-jobs',
        id: job.id,
        data: {
          automationWorkflow: jobMeta.automationWorkflowId,
          automationWorkflowRun: jobMeta.automationWorkflowRunId,
          automationTrigger: jobMeta.automationTriggerId,
          automationStepName: step.stepName,
        },
        req,
      })

      // Run the job and capture the result directly from runByID
      // This is important because PayloadCMS may delete jobs on completion (deleteJobOnComplete: true by default)
      const runResult = await this.payload.jobs.runByID({
        id: job.id,
        req
      })

      // Check the job status from the run result
      // runByID returns { jobStatus: { [jobId]: { status: 'success' | 'error' | ... } }, ... }
      const jobStatus = (runResult as any)?.jobStatus?.[job.id]
      const jobSucceeded = jobStatus?.status === 'success'

      if (jobSucceeded) {
        // Job completed successfully - try to get output from the job if it still exists
        // Note: Job may have been deleted if deleteJobOnComplete is true
        let output: Record<string, unknown> = {}
        try {
          const completedJob = await this.payload.findByID({
            id: job.id,
            collection: 'payload-jobs',
            req
          })
          const taskStatus = completedJob.taskStatus?.[completedJob.taskSlug]?.[completedJob.totalTried]
          output = taskStatus?.output || {}
        } catch {
          // Job was deleted after completion - this is expected behavior with deleteJobOnComplete: true
          // The job succeeded, so we proceed without the output
          this.logger.debug({ stepName: step.stepName }, 'Job was deleted after successful completion (deleteJobOnComplete)')
        }

        result.status = 'succeeded'
        result.output = output
        result.completedAt = new Date().toISOString()
        result.duration = new Date(result.completedAt).getTime() - new Date(result.startedAt!).getTime()
      } else {
        // Job failed - try to get error details from the job
        let errorMessage = 'Task failed'
        try {
          const completedJob = await this.payload.findByID({
            id: job.id,
            collection: 'payload-jobs',
            req
          })
          const taskStatus = completedJob.taskStatus?.[completedJob.taskSlug]?.[completedJob.totalTried]
          if (completedJob.log && completedJob.log.length > 0) {
            const latestLog = completedJob.log[completedJob.log.length - 1]
            errorMessage = latestLog.error?.message || latestLog.error || errorMessage
          }
          if (taskStatus?.output?.errorMessage) {
            errorMessage = taskStatus.output.errorMessage
          }
        } catch {
          // Job may have been deleted - use the job status from run result
          errorMessage = `Task failed with status: ${jobStatus?.status || 'unknown'}`
        }
        throw new Error(errorMessage)
      }

      context.steps[step.stepName] = {
        state: 'succeeded',
        input: resolvedInput,
        output: result.output
      }

      this.logger.info({
        stepName: step.stepName,
        duration: result.duration
      }, 'Step completed successfully')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      result.status = 'failed'
      result.error = errorMessage
      result.completedAt = new Date().toISOString()
      result.duration = new Date(result.completedAt).getTime() - new Date(result.startedAt!).getTime()

      context.steps[step.stepName] = {
        state: 'failed',
        input: resolvedInput,
        error: errorMessage
      }

      this.logger.error({
        stepName: step.stepName,
        error: errorMessage
      }, 'Step execution failed')

      throw error
    }

    return result
  }

  /**
   * Resolve step input using JSONata expressions
   */
  private async resolveStepInput(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    try {
      return await resolveInput(config, context as ExpressionContext, { timeout: 5000 })
    } catch (error) {
      this.logger.warn({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to resolve step input, using raw config')
      return config
    }
  }

  /**
   * Evaluate a condition using JSONata
   */
  public async evaluateCondition(condition: string, context: ExecutionContext): Promise<boolean> {
    try {
      return await evalCondition(condition, context as ExpressionContext, { timeout: 5000 })
    } catch (error) {
      this.logger.warn({
        condition,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to evaluate condition')
      return false
    }
  }

  /**
   * Safely serialize an object for storage
   */
  private safeSerialize(obj: unknown): unknown {
    const seen = new WeakSet()

    // Keys to completely exclude from serialization
    const excludeKeys = new Set([
      'table',
      'schema',
      '_',
      '__',
      'payload', // Exclude payload instance (contains entire config)
      'res', // Exclude response object
      'transactionID',
      'i18n',
      'fallbackLocale',
    ])

    // For req object, only keep these useful debugging properties
    const reqAllowedKeys = new Set([
      'payloadAPI', // 'local', 'REST', or 'GraphQL'
      'locale',
      'user', // authenticated user
      'method', // HTTP method
      'url', // request URL
    ])

    const serialize = (value: unknown, parentKey?: string): unknown => {
      if (value === null || typeof value !== 'object') {
        return value
      }
      if (seen.has(value)) {
        return '[Circular Reference]'
      }
      seen.add(value)

      if (Array.isArray(value)) {
        return value.map((v) => serialize(v))
      }

      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        try {
          if (excludeKeys.has(key)) {
            continue
          }
          // Special handling for req object - only include allowed keys
          if (parentKey === 'req' && !reqAllowedKeys.has(key)) {
            continue
          }
          result[key] = serialize(val, key)
        } catch {
          result[key] = '[Non-serializable]'
        }
      }
      return result
    }

    return serialize(obj)
  }

  /**
   * Execute a workflow with the given context
   */
  async execute(
    workflow: PayloadWorkflow,
    context: ExecutionContext,
    req: PayloadRequest,
    firedTrigger?: any
  ): Promise<void> {
    this.logger.info({
      workflowId: workflow.id,
      workflowName: workflow.name,
      triggerId: firedTrigger?.id,
      triggerName: firedTrigger?.name
    }, 'Starting workflow execution')

    const resolvedSteps = await this.resolveWorkflowSteps(workflow)
    const stepResults: StepResult[] = []

    for (const step of resolvedSteps) {
      stepResults.push({
        step: step.stepId,
        stepName: step.stepName,
        stepIndex: step.stepIndex,
        status: 'pending'
      })
    }

    const workflowRun = await this.payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: workflow.id,
        workflowVersion: 1,
        firedTrigger: firedTrigger?.id,
        triggerData: this.safeSerialize(context.trigger),
        status: 'running',
        startedAt: new Date().toISOString(),
        triggeredBy: context.trigger.req?.user?.email || 'system',
        stepResults,
        context: this.safeSerialize(context),
        inputs: this.safeSerialize(context.trigger),
        logs: [{
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Workflow execution started'
        }]
      },
      req
    })

    this.logger.info({
      workflowRunId: workflowRun.id,
      workflowId: workflow.id
    }, 'Workflow run record created')

    // Create job metadata for tracking workflow context in payload-jobs
    const jobMeta: WorkflowJobMeta = {
      automationWorkflowId: workflow.id,
      automationWorkflowRunId: workflowRun.id,
      automationTriggerId: firedTrigger?.id,
    }

    try {
      const executionBatches = this.resolveExecutionOrder(resolvedSteps)

      this.logger.info({
        batchCount: executionBatches.length,
        batchSizes: executionBatches.map(b => b.length)
      }, 'Resolved step execution order')

      for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex++) {
        const batch = executionBatches[batchIndex]

        this.logger.info({
          batchIndex,
          stepCount: batch.length,
          stepNames: batch.map(s => s.stepName)
        }, 'Executing batch')

        const batchPromises = batch.map(async (step) => {
          try {
            const result = await this.executeStep(step, context, req, stepResults, jobMeta)
            const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
            if (idx !== -1) {
              stepResults[idx] = result
            }
            return result
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
            if (idx !== -1) {
              stepResults[idx] = {
                ...stepResults[idx],
                status: 'failed',
                error: errorMessage,
                completedAt: new Date().toISOString()
              }
            }

            if (workflow.errorHandling === 'stop') {
              throw error
            }
            this.logger.warn({
              stepName: step.stepName,
              error: errorMessage
            }, 'Step failed but continuing due to error handling setting')
          }
        })

        await Promise.all(batchPromises)

        await this.payload.update({
          id: workflowRun.id,
          collection: 'workflow-runs',
          data: {
            stepResults,
            context: this.safeSerialize(context)
          },
          req
        })
      }

      const outputs: Record<string, unknown> = {}
      for (const result of stepResults) {
        if (result.status === 'succeeded' && result.output) {
          outputs[result.stepName] = result.output
        }
      }

      await this.payload.update({
        id: workflowRun.id,
        collection: 'workflow-runs',
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
          stepResults,
          context: this.safeSerialize(context),
          outputs,
          logs: [
            ...(workflowRun.logs || []),
            {
              timestamp: new Date().toISOString(),
              level: 'info',
              message: 'Workflow execution completed successfully'
            }
          ]
        },
        req
      })

      this.logger.info({
        workflowRunId: workflowRun.id,
        workflowId: workflow.id
      }, 'Workflow execution completed')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      await this.payload.update({
        id: workflowRun.id,
        collection: 'workflow-runs',
        data: {
          status: 'failed',
          completedAt: new Date().toISOString(),
          stepResults,
          context: this.safeSerialize(context),
          error: errorMessage,
          logs: [
            ...(workflowRun.logs || []),
            {
              timestamp: new Date().toISOString(),
              level: 'error',
              message: `Workflow execution failed: ${errorMessage}`
            }
          ]
        },
        req
      })

      this.logger.error({
        workflowRunId: workflowRun.id,
        workflowId: workflow.id,
        error: errorMessage
      }, 'Workflow execution failed')

      throw error
    }
  }
}
