import type { Payload, PayloadRequest } from 'payload'

import {
  evaluateCondition as evalCondition,
  resolveStepInput as resolveInput,
  type ExpressionContext
} from './expression-engine.js'
import { expectStepOutput, releaseStepOutput } from './step-output-capture.js'
import {getPluginConfig} from "../plugin/get-plugin-config.js";
import {WorkflowsPluginConfig} from "../plugin/config-types.js";
import { describeError } from '../utils/describe-error.js'

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
    slug: string
    stepName?: string | null
    inputOverrides?: Record<string, unknown> | null
    condition?: string | null
    dependencies?: Array<{ slug: string }> | null
    position?: { x: number; y: number } | null
  }> | null
  errorHandling?: 'stop' | 'continue' | 'retry' | null
  maxRetries?: number | null
  retryDelay?: number | null
  timeout?: number | null
  /**
   * JSONata expression deciding whether a finished run is deleted instead of
   * kept in `workflow-runs` (see `WorkflowExecutor.shouldDiscardRun`).
   */
  discardRunWhen?: string | null
  [key: string]: unknown
}

/**
 * Type for a resolved workflow step (with base step data merged)
 */
export type ResolvedStep = {
  stepIndex: number
  slug: string
  stepId: string | number
  stepName: string
  stepType: string
  config: Record<string, unknown>
  condition?: string | null
  dependencies: string[]
  /**
   * How often a failed attempt of this step is retried (0 = never), after
   * {@link resolveRetryPolicy} combined the step's and the workflow's settings.
   */
  maxRetries: number
  /** Milliseconds to wait before each retry. */
  retryDelay: number
}

/** Retries and delay used when retrying is switched on but the number field is empty. */
export const DEFAULT_MAX_RETRIES = 3
export const DEFAULT_RETRY_DELAY_MS = 1000

/**
 * Default for `execution.maxInProcessRetryDelay`: in queue mode, a retry delay
 * longer than this is not slept through inside the job but handed back to the
 * jobs queue (see `WorkflowExecutor.suspendForRetry`).
 */
export const DEFAULT_MAX_IN_PROCESS_RETRY_DELAY_MS = 5000

/**
 * Longest delay a Node.js timer supports (2^31 - 1 ms, about 24.8 days).
 * `setTimeout` with a larger value fires immediately instead.
 */
const MAX_TIMER_MS = 2_147_483_647

const nonNegativeInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback

/**
 * The retry policy that applies to one step.
 *
 * - A step with `retryOnFailure` uses its own `maxRetries` and `retryDelay`
 *   (3 and 1000 ms when empty), whatever the workflow's `errorHandling` is.
 *   Its `maxRetries: 0` therefore switches retries off for that step.
 * - Any other step is retried only when the workflow's `errorHandling` is
 *   `'retry'`, with the workflow's `maxRetries` and `retryDelay`.
 * - Otherwise the step is not retried.
 */
export const resolveRetryPolicy = (
  step: { maxRetries?: null | number; retryDelay?: null | number; retryOnFailure?: boolean | null },
  workflow: { errorHandling?: null | string; maxRetries?: null | number; retryDelay?: null | number }
): { maxRetries: number; retryDelay: number } => {
  const source = step.retryOnFailure === true ? step : workflow.errorHandling === 'retry' ? workflow : undefined
  if (!source) {
    return { maxRetries: 0, retryDelay: 0 }
  }
  return {
    maxRetries: nonNegativeInteger(source.maxRetries, DEFAULT_MAX_RETRIES),
    retryDelay: nonNegativeInteger(source.retryDelay, DEFAULT_RETRY_DELAY_MS)
  }
}

/** Thrown inside the executor when a run exceeds its workflow's `timeout`. */
export class WorkflowTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Workflow timed out after ${timeoutMs} ms`)
    this.name = 'WorkflowTimeoutError'
  }
}

/**
 * State shared by everything that works on one call of `runSteps`.
 */
interface RunState {
  /** Aborted when the run closes, which cuts retry waits short. */
  abort: AbortController
  /**
   * Whether a retry wait longer than `maxInProcessRetryDelay` may be handed
   * to the jobs queue. Only true for runs executed by the queued-run job.
   */
  canDefer: boolean
  /**
   * True once the run's outcome is final while steps may still be in flight:
   * it timed out, or a step failed and the run stopped. A step that finishes
   * after that must not record anything, start a retry or touch the context.
   */
  closed: boolean
  /** Steps currently executing, by step index. Used to fail them on timeout. */
  inFlight: Map<number, { jobId?: number | string; result: StepResult; step: ResolvedStep }>
  /** Log entries about retries, appended to the run's `logs` when it is saved. */
  logs: Array<{ level: 'error' | 'info' | 'warn'; message: string; timestamp: string }>
  maxInProcessRetryDelay: number
}

/** Attempt bookkeeping of a step whose retry was handed to the jobs queue. */
interface StepResume {
  attempts: number
  lastError?: string
  /** Epoch milliseconds before which the next attempt must not start. */
  notBefore?: number
  startedAt?: string
}

/**
 * Resolves after `ms`, or as soon as `signal` aborts. The timer is cleared on
 * abort so a closed run leaves nothing behind that keeps the process alive.
 */
const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

export interface ExecutionContext {
  steps: Record<string, any>
  trigger: Record<string, any>
}

export interface StepResult {
  step?: string | number
  slug: string
  stepName: string
  stepIndex: number
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  startedAt?: string
  completedAt?: string
  duration?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  /** Attempts started so far: 1 for a step that ran once, 0 for one that never ran. */
  attempts?: number
  /** Retries made, i.e. `attempts - 1`. */
  retryCount?: number
  /**
   * Error of the most recent failed attempt. Kept when a later attempt
   * succeeds, so the run shows why the step had to be retried.
   */
  lastError?: string
  /**
   * Set on a `pending` step whose retry was handed to the jobs queue: the
   * time the next attempt is due. Cleared once the step finishes.
   */
  nextRetryAt?: null | string
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

/**
 * Auth secrets, never stored on a run and never passed into a step's input,
 * whatever the plugin options and wherever they appear. On auth collections
 * `previousDoc` is read with hidden fields, so it carries the password hash,
 * salt, reset and verification tokens and API keys.
 */
const AUTH_SECRET_KEYS = new Set([
  '_verificationToken',
  'apiKey',
  'apiKeyIndex',
  'hash',
  'password',
  'resetPasswordExpiration',
  'resetPasswordToken',
  'salt',
])

/**
 * Session tokens passed in hook arguments (afterLogin and afterRefresh
 * `token`, afterMe `response.token`). Dropped from stored trigger snapshots
 * outside the document; a document's own `token` field (an invite code, say)
 * is content that workflows may rely on.
 */
const SESSION_TOKEN_KEYS = new Set(['refreshToken', 'token'])

/**
 * Keys holding the document a hook acts on. `user` fields inside them are
 * document content, not the acting user, so `stripUserData` keeps them.
 */
const DOCUMENT_KEYS = new Set(['data', 'doc', 'originalDoc', 'previousDoc'])

/**
 * Slug of the job task that runs a queued workflow run's steps when the
 * plugin is configured with `execution: { mode: 'queue' }`.
 */
export const WORKFLOW_RUN_TASK_SLUG = 'automation-workflow-run'

/**
 * A step result from an earlier run, as stored in `workflow-runs.stepResults`.
 * `step` may be the related step's id or the populated step document.
 */
export interface PreviousStepResult {
  attempts?: null | number
  completedAt?: null | string
  duration?: null | number
  error?: null | string
  lastError?: null | string
  nextRetryAt?: null | string
  startedAt?: null | string
  input?: null | Record<string, unknown>
  output?: null | Record<string, unknown>
  /** Missing on results stored before `stepResults.slug` existed. */
  slug?: null | string
  status?: null | string
  step?: null | number | string | { id: number | string }
  stepIndex?: null | number
  stepName?: null | string
}

export interface ExecuteOptions {
  /**
   * Called with the new run's id as soon as the `workflow-runs` record
   * exists, before any step runs. Lets a caller find the run even when
   * `execute` later throws because a step failed.
   */
  onRunCreated?: (workflowRunId: number | string) => void

  /**
   * Called with the run's id when the workflow's `discardRunWhen` expression
   * was true and the finished run was deleted from `workflow-runs`. The id
   * `execute` returns then no longer refers to a stored document. Not called
   * for a run that was only queued (`execution.mode: 'queue'`): whether that
   * run is discarded is decided later, when a job runner has run its steps.
   */
  onRunDiscarded?: (workflowRunId: number | string) => void

  /**
   * Keep the run in `workflow-runs` even when the workflow's
   * `discardRunWhen` expression is true. For callers that need the stored
   * run afterwards; `retryWorkflowRun` uses it to return the new run.
   */
  keepRun?: boolean

  /**
   * Step results of an earlier run of the same workflow. A step whose earlier
   * result succeeded, at the same position, referencing the same
   * `automation-steps` document and (when the result has one) under the same
   * slug, is not run again: its stored input and output
   * are copied into this run and into `steps.<slug>` (and the step name alias) for later expressions.
   */
  reuseSucceededSteps?: PreviousStepResult[]

  /**
   * Run the steps now even when the plugin is configured with
   * `execution.mode: 'queue'`. `retryWorkflowRun` uses this so a retry
   * returns a finished run instead of one stuck in `pending`.
   */
  inline?: boolean

  /** Message of the run's first log entry. Defaults to "Workflow execution started". */
  startMessage?: string
}

const relationId = (value: PreviousStepResult['step']): number | string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  return typeof value === 'object' ? value.id : value
}

export class WorkflowExecutor {
  private config: WorkflowsPluginConfig<string, string>;
  // Which step owns each key of `context.steps`. Kept on the executor rather
  // than in process-wide shared state because an execution context never
  // leaves the executor (and so the copy of this module) that created it.
  private stepContextOwners = new WeakMap<ExecutionContext, Map<string, string>>()

  constructor(
    private payload: Payload,
    private logger: Payload['logger']
  ) {
    this.config = getPluginConfig(payload)
  }

  /**
   * Record a step's state in the expression context under both its slug and its
   * display name. Slug is the stable identifier everywhere else in the plugin —
   * dependencies resolve by slug in resolveExecutionOrder — but output references
   * used to be keyed by name only, so `{{steps.<slug>.output}}` silently resolved
   * to nothing (the engine returns the unevaluated `{{...}}` string as a literal
   * on failure) while `dependencies: ['<slug>']` worked. The name stays as a key
   * so workflows written against it keep resolving.
   */
  private setStepContext(
    context: ExecutionContext,
    step: ResolvedStep,
    entry: Record<string, unknown>
  ): void {
    let owners = this.stepContextOwners.get(context)
    if (!owners) {
      owners = new Map<string, string>()
      this.stepContextOwners.set(context, owners)
    }

    context.steps[step.slug] = entry
    owners.set(step.slug, step.slug)

    if (step.stepName && step.stepName !== step.slug) {
      const existingSlug = owners.get(step.stepName)
      if (existingSlug && existingSlug !== step.slug) {
        this.logger.warn({
          contextKey: step.stepName,
          existingSlug,
          stepSlug: step.slug
        }, 'Skipping step name context alias because it collides with another step slug')
        return
      }

      context.steps[step.stepName] = entry
      owners.set(step.stepName, step.slug)
    }
  }

  /**
   * Claim every step's own slug as its context-key owner before any batch runs.
   * Batches execute concurrently (see `execute`), and a step only calls
   * setStepContext for the first time partway through its own execution — so
   * without this, a step whose display name equals another step's not-yet-run
   * slug could transiently win that key and have a third step's expression
   * silently resolve against the wrong step's data. All slugs are known from
   * `resolvedSteps` before batch execution begins, so they can all be claimed
   * upfront instead of racing to claim themselves at execution time.
   */
  private seedStepContextOwners(context: ExecutionContext, steps: ResolvedStep[]): void {
    let owners = this.stepContextOwners.get(context)
    if (!owners) {
      owners = new Map<string, string>()
      this.stepContextOwners.set(context, owners)
    }

    for (const step of steps) {
      owners.set(step.slug, step.slug)
    }
  }

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

      const dependencies = (workflowStep.dependencies || []).map(d => d.slug)

      resolvedSteps.push({
        stepIndex: i,
        slug: workflowStep.slug,
        stepId: baseStep.id,
        stepName: workflowStep.stepName || baseStep.name || `step-${i}`,
        stepType: baseStep.type as string,
        config: mergedConfig,
        condition: workflowStep.condition,
        dependencies,
        ...resolveRetryPolicy(baseStep, workflow)
      })
    }

    return resolvedSteps
  }

  /**
   * Resolve step execution order based on dependencies
   */
  private resolveExecutionOrder(steps: ResolvedStep[]): ResolvedStep[][] {
    // Create a map from slug to step for lookups
    const stepBySlug = new Map<string, ResolvedStep>()
    for (const step of steps) {
      stepBySlug.set(step.slug, step)
    }

    // Validate all dependencies exist
    for (const step of steps) {
      for (const depSlug of step.dependencies) {
        if (!stepBySlug.has(depSlug)) {
          throw new Error(`Step "${step.slug}" depends on non-existent step "${depSlug}"`)
        }
      }
    }

    const indegree = new Map<string, number>()
    const dependents = new Map<string, string[]>()

    for (const step of steps) {
      indegree.set(step.slug, step.dependencies.length)
      dependents.set(step.slug, [])
    }

    for (const step of steps) {
      for (const depSlug of step.dependencies) {
        const deps = dependents.get(depSlug) || []
        deps.push(step.slug)
        dependents.set(depSlug, deps)
      }
    }

    const executionBatches: ResolvedStep[][] = []
    const processed = new Set<string>()

    while (processed.size < steps.length) {
      const currentBatch: ResolvedStep[] = []

      for (const step of steps) {
        if (!processed.has(step.slug) && indegree.get(step.slug) === 0) {
          currentBatch.push(step)
        }
      }

      if (currentBatch.length === 0) {
        throw new Error('Circular dependency detected in workflow steps')
      }

      executionBatches.push(currentBatch)

      for (const step of currentBatch) {
        processed.add(step.slug)
        for (const depSlug of dependents.get(step.slug) || []) {
          indegree.set(depSlug, (indegree.get(depSlug) || 1) - 1)
        }
      }
    }

    return executionBatches
  }

  /**
   * Execute a single workflow step, retrying failed attempts according to the
   * step's retry policy (see {@link resolveRetryPolicy}).
   *
   * Never throws for a failing step. The returned result has status:
   * - `succeeded`, `skipped` (condition not met) or `failed` (the last allowed
   *   attempt failed): the step is finished.
   * - `pending` with `nextRetryAt`: an attempt failed and the wait before the
   *   next one is longer than the run may sleep in-process, so the caller has
   *   to suspend the run (see `suspendForRetry`).
   *
   * Once `run.closed` is set the return value is meaningless and nothing is
   * written to the context any more: the run has already been recorded.
   */
  private async executeStep(
    step: ResolvedStep,
    context: ExecutionContext,
    req: PayloadRequest,
    jobMeta: WorkflowJobMeta,
    run: RunState,
    resume?: StepResume
  ): Promise<StepResult> {
    const result: StepResult = {
      step: step.stepId,
      slug: step.slug,
      stepName: step.stepName,
      stepIndex: step.stepIndex,
      status: 'running',
      startedAt: resume?.startedAt ?? new Date().toISOString(),
      attempts: resume?.attempts ?? 0,
      retryCount: Math.max(0, (resume?.attempts ?? 0) - 1),
      lastError: resume?.lastError,
      nextRetryAt: null
    }

    this.logger.info({
      stepName: step.stepName,
      stepType: step.stepType,
      stepIndex: step.stepIndex
    }, 'Executing step')

    // A resumed step already passed its condition before its first attempt.
    if (step.condition && !resume) {
      const conditionMet = await this.evaluateCondition(step.condition, context)
      if (run.closed) {
        return result
      }
      if (!conditionMet) {
        this.logger.info({
          stepName: step.stepName,
          condition: step.condition
        }, 'Step condition not met, skipping')

        result.status = 'skipped'
        result.completedAt = new Date().toISOString()
        result.output = { reason: 'Condition not met', skipped: true }

        this.setStepContext(context, step, {
          state: 'skipped',
          output: result.output
        })

        return result
      }
    }

    // Resolve input using JSONata expressions
    const resolvedInput = this.sanitizeStepData(
      await this.resolveStepInput(step.config, this.stepInputContext(context))
    )
    if (run.closed) {
      return result
    }
    result.input = resolvedInput

    this.setStepContext(context, step, {
      state: 'running',
      input: resolvedInput
    })

    const tracker: { jobId?: number | string; result: StepResult; step: ResolvedStep } = { result, step }
    run.inFlight.set(step.stepIndex, tracker)
    const maxAttempts = step.maxRetries + 1
    let notBefore = resume?.notBefore

    try {
      for (;;) {
        // Wait until the retry is due. Looping covers delays longer than one
        // timer can hold (see MAX_TIMER_MS).
        while (notBefore !== undefined) {
          const wait = notBefore - Date.now()
          if (wait <= 0) {
            notBefore = undefined
            break
          }
          if (run.canDefer && wait > run.maxInProcessRetryDelay) {
            result.status = 'pending'
            result.nextRetryAt = new Date(notBefore).toISOString()
            this.setStepContext(context, step, { state: 'pending', input: resolvedInput })
            return result
          }
          await sleep(Math.min(wait, MAX_TIMER_MS), run.abort.signal)
          if (run.closed) {
            return result
          }
        }

        result.attempts = (result.attempts ?? 0) + 1
        result.retryCount = result.attempts - 1

        try {
          const output = await this.runStepAttempt(step, resolvedInput, req, jobMeta, tracker)
          if (run.closed) {
            return result
          }

          result.status = 'succeeded'
          result.output = this.sanitizeStepData(output)
          result.completedAt = new Date().toISOString()
          result.duration = new Date(result.completedAt).getTime() - new Date(result.startedAt!).getTime()

          this.setStepContext(context, step, {
            state: 'succeeded',
            input: resolvedInput,
            output: result.output
          })

          this.logger.info({
            attempts: result.attempts,
            stepName: step.stepName,
            duration: result.duration
          }, 'Step completed successfully')

          return result
        } catch (error) {
          if (run.closed) {
            return result
          }
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          result.lastError = errorMessage

          if (result.attempts >= maxAttempts) {
            result.status = 'failed'
            result.error = errorMessage
            result.completedAt = new Date().toISOString()
            result.duration = new Date(result.completedAt).getTime() - new Date(result.startedAt!).getTime()

            this.setStepContext(context, step, {
              state: 'failed',
              input: resolvedInput,
              error: errorMessage
            })

            this.logger.error({
              attempts: result.attempts,
              stepName: step.stepName,
              error: errorMessage
            }, 'Step execution failed')

            return result
          }

          notBefore = Date.now() + step.retryDelay
          const message = `Step "${step.stepName}" failed on attempt ${result.attempts} of ${maxAttempts}: ${errorMessage}. Retrying in ${step.retryDelay} ms`
          run.logs.push({ level: 'warn', message, timestamp: new Date().toISOString() })
          this.logger.warn({
            attempt: result.attempts,
            maxAttempts,
            retryDelay: step.retryDelay,
            stepName: step.stepName,
            error: errorMessage
          }, 'Step attempt failed, retrying')
        }
      }
    } finally {
      // After a timeout `runSteps` reads the in-flight entries to fail them,
      // so a closed run keeps them.
      if (!run.closed) {
        run.inFlight.delete(step.stepIndex)
      }
    }
  }

  /**
   * Run one attempt of a step as its own Payload job and return the task's
   * output. Throws with the task's error message when the attempt fails.
   *
   * Every attempt is a new job rather than a retry of the same job: a job
   * queued for a single task takes its retry count from the task's static
   * config, while a step's retry policy is data on the step and workflow
   * documents. A new job per attempt also keeps one `payload-jobs` record
   * (with the automation fields) per attempt.
   */
  private async runStepAttempt(
    step: ResolvedStep,
    resolvedInput: Record<string, unknown>,
    req: PayloadRequest,
    jobMeta: WorkflowJobMeta,
    tracker: { jobId?: number | string }
  ): Promise<Record<string, unknown>> {
    const job = await this.payload.jobs.queue({
      input: resolvedInput,
      req,
      task: step.stepType,
    })
    tracker.jobId = job.id

    if (this.config.debug) {
      this.logger.info(job, `Queued job for step '${step.stepName}'`)
    }

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

    // Payload's job runner only reports a status, and with its default
    // jobs.deleteJobOnComplete it deletes the job (and the output logged in
    // it) before runByID returns. The wrapped task handler hands the output
    // over through this slot instead.
    const outputSlot = expectStepOutput(this.payload, job.id)
    let runResult: unknown
    try {
      runResult = await this.payload.jobs.runByID({
        id: job.id,
        req
      })
    } finally {
      releaseStepOutput(this.payload, job.id, outputSlot)
    }

    if (this.config.debug) {
      this.logger.info(runResult, `Run result for step '${step.stepName}'`)
    }

    // Check the job status from the run result
    // runByID returns { jobStatus: { [jobId]: { status: 'success' | 'error' | ... } }, ... }
    const jobStatus = (runResult as any)?.jobStatus?.[job.id]

    if (jobStatus?.status === 'success') {
      let output: Record<string, unknown> = outputSlot.output ?? {}
      if (!outputSlot.captured) {
        // The handler was not wrapped (a task with a module-path handler, or
        // one added to the config after this plugin ran). Read the output
        // from the job, which only works if the job has not been deleted.
        try {
          const completedJob = await this.payload.findByID({
            id: job.id,
            collection: 'payload-jobs',
            req
          })
          const taskStatus = completedJob.taskStatus?.[completedJob.taskSlug]?.[completedJob.totalTried]
          output = taskStatus?.output || {}
        } catch {
          this.logger.warn(
            { stepName: step.stepName, stepType: step.stepType },
            'Step output unavailable: the job was deleted on completion and the task handler is not a function the plugin could wrap'
          )
        }
      }
      return output
    }

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

    if (jobStatus?.status === 'error') {
      // The task has Payload-level `retries` left, so Payload kept the job
      // queued for the host's job runner. The executor has already counted
      // this attempt as failed and decides about retries itself; without
      // cancelling, the task would run again later outside the workflow run.
      await this.cancelJob(job.id, req)
    }

    throw new Error(errorMessage)
  }

  /**
   * Mark a step's job as cancelled so no job runner picks it up (again).
   * Best effort: this cannot interrupt a task handler that is already running.
   */
  private async cancelJob(jobId: number | string, req: PayloadRequest): Promise<void> {
    try {
      await this.payload.jobs.cancelByID({ id: jobId, req })
    } catch (error) {
      this.logger.warn({
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Could not cancel step job')
    }
  }

  /**
   * Resolve step input using JSONata expressions
   */
  private async resolveStepInput(
    config: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<Record<string, unknown>> {
    try {
      return await resolveInput(config, context as ExpressionContext, {
        timeout: 5000,
        debug: this.config.debug,
        logger: this.logger
      })
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
   * The context step input expressions are evaluated against. With
   * `stripUserData`, the acting user is hidden from them: `trigger.user`,
   * `trigger.req.user`, `trigger.response.user` and `trigger.result.user`
   * read as undefined, so no expression can copy the user (or its fields)
   * into a step input, the run record or `payload-jobs`. Everything else,
   * including the document, stays live. Trigger and step conditions still
   * see the full context, because nothing they read is stored.
   */
  private stepInputContext(context: ExecutionContext): ExecutionContext {
    if (this.config.stripUserData !== true) {
      return context
    }
    // Plain shallow copies without `user`, so the step-data cleaner (which
    // only walks plain objects) still cleans whatever an expression returns,
    // e.g. `{{trigger}}` or `{{trigger.req}}`.
    const withoutUser = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value
      }
      const { user: _user, ...rest } = value as Record<string, unknown>
      return rest
    }
    const trigger = withoutUser(context.trigger) as ExecutionContext['trigger']
    for (const key of ['req', 'response', 'result']) {
      if (trigger[key] !== undefined) {
        trigger[key] = withoutUser(trigger[key])
      }
    }
    return { ...context, trigger }
  }

  /**
   * Clean a step's resolved input or its output before it is passed to the
   * step's job, stored on the run, or exposed to later steps as
   * `steps.<slug>`. Unlike `safeSerialize`, this keeps every other key and
   * value as it is, because the step receives the result at runtime:
   * - AUTH_SECRET_KEYS are dropped at any depth (an input like
   *   `{{trigger.previousDoc}}` on an auth collection would otherwise carry
   *   the password hash into the step, the run and `payload-jobs`).
   * - With `stripUserData`, a `user` key whose value is an object (a user
   *   document) is dropped outside DOCUMENT_KEYS. Scalar `user` values, such
   *   as a relationship id, are kept.
   * Session token keys are not touched here: `token` is a common, legitimate
   * input name, and a session token only reaches a step input when the
   * workflow references it explicitly.
   */
  private sanitizeStepData<T>(value: T): T {
    const stripUser = this.config.stripUserData === true
    // Maps each visited original to its cleaned copy. The copy is registered
    // before its children are cleaned, so an object referenced twice (e.g.
    // `{{trigger}}` next to `{{trigger.previousDoc}}`) is cleaned every time
    // it appears, and a cycle maps back to the cleaned copy instead of
    // recursing forever. Inside and outside a document the rules differ, so
    // each has its own map.
    const cleanedOutside = new WeakMap<object, unknown>()
    const cleanedInside = new WeakMap<object, unknown>()

    const clean = (current: unknown, inDocument: boolean): unknown => {
      if (current === null || typeof current !== 'object') {
        return current
      }
      const cleaned = inDocument ? cleanedInside : cleanedOutside
      const done = cleaned.get(current)
      if (done !== undefined) {
        return done
      }
      if (Array.isArray(current)) {
        const copy: unknown[] = []
        cleaned.set(current, copy)
        for (const item of current) {
          copy.push(clean(item, inDocument))
        }
        return copy
      }
      const proto = Object.getPrototypeOf(current)
      if (proto !== Object.prototype && proto !== null) {
        // Dates, Buffers and class instances are passed through untouched.
        return current
      }

      const copy: Record<string, unknown> = {}
      cleaned.set(current, copy)
      for (const [key, val] of Object.entries(current as Record<string, unknown>)) {
        if (AUTH_SECRET_KEYS.has(key)) {
          continue
        }
        if (stripUser && !inDocument && key === 'user' && val !== null && typeof val === 'object') {
          continue
        }
        copy[key] = clean(val, inDocument || DOCUMENT_KEYS.has(key))
      }
      return copy
    }

    return clean(value, false) as T
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

    // AUTH_SECRET_KEYS are dropped everywhere, SESSION_TOKEN_KEYS outside the
    // document. With `stripUserData`, every `user` key outside the document
    // is dropped too: `req.user`, a trigger's own `user` (custom triggers,
    // auth hooks), afterMe's `response.user`, afterOperation's `result.user`.
    const stripUser = this.config.stripUserData === true

    const serialize = (value: unknown, parentKey?: string, inDocument = false): unknown => {
      if (value === null || typeof value !== 'object') {
        return value
      }
      if (seen.has(value)) {
        return '[Circular Reference]'
      }
      seen.add(value)

      if (Array.isArray(value)) {
        return value.map((v) => serialize(v, undefined, inDocument))
      }

      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        try {
          if (excludeKeys.has(key) || AUTH_SECRET_KEYS.has(key)) {
            continue
          }
          if (!inDocument && SESSION_TOKEN_KEYS.has(key)) {
            continue
          }
          if (stripUser && !inDocument && key === 'user') {
            continue
          }
          // Special handling for req object - only include allowed keys
          if (parentKey === 'req' && !reqAllowedKeys.has(key)) {
            continue
          }
          result[key] = serialize(val, key, inDocument || DOCUMENT_KEYS.has(key))
        } catch {
          result[key] = '[Non-serializable]'
        }
      }
      return result
    }

    return serialize(obj)
  }

  /**
   * Build a `skipped` result for `step` when a step it depends on failed (or
   * was itself skipped for that reason), so the step does not run with that
   * dependency's output missing. Returns undefined when the step should run.
   *
   * A step with its own `condition` is not skipped here: its condition decides,
   * which lets a step such as one with `steps.<slug>.state = 'failed'` handle
   * the failure of the step it depends on.
   */
  private skipForFailedDependency(
    step: ResolvedStep,
    context: ExecutionContext,
    unavailableSlugs: Map<string, 'failed' | 'skipped'>
  ): StepResult | undefined {
    if (step.condition) {
      return undefined
    }
    const failedDependency = step.dependencies.find((dep) => unavailableSlugs.has(dep))
    if (!failedDependency) {
      return undefined
    }

    const reason = unavailableSlugs.get(failedDependency) === 'failed'
      ? `Dependency "${failedDependency}" failed`
      : `Dependency "${failedDependency}" was skipped because a step it depends on failed`
    this.logger.info({ stepName: step.stepName, dependency: failedDependency }, 'Skipping step: a dependency failed')

    const now = new Date().toISOString()
    const output = { reason, skipped: true }
    this.setStepContext(context, step, { state: 'skipped', output })
    return {
      step: step.stepId,
      slug: step.slug,
      stepName: step.stepName,
      stepIndex: step.stepIndex,
      status: 'skipped',
      startedAt: now,
      completedAt: now,
      output
    }
  }

  /**
   * Find the earlier succeeded result that can stand in for `step`, if any.
   *
   * A step is only reused when every step it depends on was reused too:
   * if a dependency runs again, its output may differ, so the dependent's
   * earlier output is stale. Batches run in dependency order, so
   * `reusedSlugs` already holds the outcome for every dependency, which makes
   * the check transitive.
   */
  private findReusableResult(
    step: ResolvedStep,
    previous: PreviousStepResult[] | undefined,
    reusedSlugs: Set<string>
  ): PreviousStepResult | undefined {
    if (!step.dependencies.every((dep) => reusedSlugs.has(dep))) {
      return undefined
    }
    return previous?.find((candidate) =>
      candidate.status === 'succeeded' &&
      candidate.stepIndex === step.stepIndex &&
      String(relationId(candidate.step)) === String(step.stepId) &&
      // Expressions and dependencies refer to a step by slug, so a result
      // stored under another slug belongs to a different step. Results
      // stored before the slug was recorded only match on position and step.
      (!candidate.slug || candidate.slug === step.slug)
    )
  }

  /**
   * Execute a workflow with the given context.
   *
   * With the default `execution.mode: 'inline'` every step runs before this
   * method returns, so a caller inside a collection hook waits for all of
   * them. With `execution.mode: 'queue'` this only records a `pending` run and
   * queues a `WORKFLOW_RUN_TASK_SLUG` job; the steps run when the host's job
   * runner picks that job up (see `executeQueuedRun`).
   *
   * @returns The id of the `workflow-runs` record. If a step fails with
   *   `errorHandling: 'stop'`, the failure is recorded on the run and the error
   *   is rethrown; use `options.onRunCreated` to get the id in that case.
   *   In queue mode the id of the `pending` run is returned as soon as its
   *   job is queued; `options.inline` runs the steps right away instead.
   */
  async execute(
    workflow: PayloadWorkflow,
    context: ExecutionContext,
    req: PayloadRequest,
    firedTrigger?: any,
    options: ExecuteOptions = {}
  ): Promise<number | string> {
    this.logger.info({
      workflowId: workflow.id,
      workflowName: workflow.name,
      triggerId: firedTrigger?.id,
      triggerName: firedTrigger?.name
    }, 'Starting workflow execution')

    const resolvedSteps = await this.resolveWorkflowSteps(workflow)
    const queued = this.config.execution?.mode === 'queue' && options.inline !== true

    const startedAt = Date.now()
    const workflowRun = await this.payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: workflow.id,
        workflowVersion: 1,
        firedTrigger: firedTrigger?.id,
        triggerData: this.safeSerialize(context.trigger),
        status: queued ? 'pending' : 'running',
        startedAt: new Date(startedAt).toISOString(),
        triggeredBy: this.describeTriggeredBy(req?.user ?? context.trigger.req?.user),
        stepResults: this.pendingStepResults(resolvedSteps),
        context: this.safeSerialize(context),
        inputs: this.safeSerialize(context.trigger),
        logs: [{
          timestamp: new Date().toISOString(),
          level: 'info',
          message: options.startMessage ?? (queued ? 'Workflow execution queued' : 'Workflow execution started')
        }]
      },
      req
    })

    options.onRunCreated?.(workflowRun.id)

    this.logger.info({
      workflowRunId: workflowRun.id,
      workflowId: workflow.id
    }, 'Workflow run record created')

    if (queued) {
      const queue = this.config.execution?.queue
      await this.payload.jobs.queue({
        input: { workflowRunId: String(workflowRun.id) },
        ...(queue ? { queue } : {}),
        req,
        task: WORKFLOW_RUN_TASK_SLUG,
      })
      this.logger.info({
        workflowRunId: workflowRun.id,
        workflowId: workflow.id,
        queue: queue ?? 'default'
      }, 'Workflow run queued')
      return workflowRun.id
    }

    await this.runSteps(
      workflow,
      context,
      req,
      workflowRun,
      resolvedSteps,
      firedTrigger?.id,
      {
        keepRun: options.keepRun,
        onRunDiscarded: options.onRunDiscarded,
        reuseSucceededSteps: options.reuseSucceededSteps,
        startedAt
      }
    )
    return workflowRun.id
  }

  /**
   * Run the steps of a run that `execute` queued with `execution.mode: 'queue'`.
   * Called by the `WORKFLOW_RUN_TASK_SLUG` job handler.
   *
   * The trigger context is rebuilt from the run's stored `triggerData`, so
   * expressions see the serialized trigger (doc, previousDoc, operation, ...)
   * rather than the live hook arguments, and steps run with the job runner's
   * `req` rather than the request that fired the trigger.
   */
  async executeQueuedRun(workflowRunId: number | string, req: PayloadRequest): Promise<void> {
    const workflowRun = await this.payload.findByID({
      collection: 'workflow-runs',
      id: workflowRunId,
      depth: 0,
      req
    })

    if (workflowRun.status !== 'pending') {
      // A job retried after the run already started must not run the steps twice.
      this.logger.warn({
        workflowRunId,
        status: workflowRun.status
      }, 'Skipping queued workflow run that is no longer pending')
      return
    }

    const workflowId = typeof workflowRun.workflow === 'object' && workflowRun.workflow !== null
      ? (workflowRun.workflow as { id: number | string }).id
      : workflowRun.workflow as number | string
    const firedTriggerId = typeof workflowRun.firedTrigger === 'object' && workflowRun.firedTrigger !== null
      ? (workflowRun.firedTrigger as { id: number | string }).id
      : (workflowRun.firedTrigger as number | string | null | undefined) ?? undefined

    // A run that `suspendForRetry` paused is `pending` again but already has
    // step results; a run that never started has only untouched placeholders.
    const storedResults = (workflowRun.stepResults ?? []) as PreviousStepResult[]
    const resuming = storedResults.some((result) =>
      (result.status !== 'pending' && result.status !== null && result.status !== undefined) ||
      (result.attempts ?? 0) > 0
    )
    // The workflow's timeout counts from the first start, also across pauses.
    const startedAt = resuming && workflowRun.startedAt
      ? new Date(workflowRun.startedAt as string).getTime()
      : Date.now()

    let workflow: PayloadWorkflow
    let resolvedSteps: ResolvedStep[]
    let startedRun: { id: number | string; logs?: unknown[] | null }
    let claimed = false
    try {
      workflow = await this.payload.findByID({
        collection: 'workflows',
        id: workflowId,
        depth: 2,
        req
      }) as unknown as PayloadWorkflow
      resolvedSteps = await this.resolveWorkflowSteps(workflow)
      claimed = await this.claimPendingRun(workflowRun.id, req)
      if (!claimed) {
        this.logger.warn({ workflowRunId }, 'Queued workflow run was already claimed by another job runner')
        return
      }
      // The run is ours now; record the start through the normal API so
      // hooks run. A failure here throws and marks the run failed below.
      startedRun = await this.payload.update({
        collection: 'workflow-runs',
        id: workflowRun.id,
        data: {
          ...(resuming ? {} : { startedAt: new Date(startedAt).toISOString() }),
          logs: [
            ...(workflowRun.logs || []),
            {
              timestamp: new Date().toISOString(),
              level: 'info',
              message: resuming ? 'Workflow execution resumed' : 'Workflow execution started'
            }
          ]
        },
        req
      })
    } catch (error) {
      // Without this the run would stay 'pending' forever. Only mark it failed
      // when this runner holds the claim, or can still take it: a run another
      // runner claimed in the meantime belongs to that runner.
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const ownsRun = claimed || await this.claimPendingRun(workflowRun.id, req).catch(() => false)
      if (!ownsRun) {
        throw error
      }
      await this.recordRunFailure(
        workflowRun.id,
        `Could not start queued workflow run: ${errorMessage}`,
        {},
        req
      )
      throw error
    }

    const context: ExecutionContext = {
      steps: {},
      trigger: (workflowRun.triggerData as ExecutionContext['trigger'] | null) ?? {}
    }

    await this.runSteps(workflow, context, req, startedRun, resolvedSteps, firedTriggerId, {
      canDefer: true,
      resumeFrom: resuming ? storedResults : undefined,
      startedAt
    })
  }

  /**
   * Atomically switch a run from `pending` to `running`. Returns `false` when
   * the run was not pending any more, i.e. another job runner claimed it.
   *
   * Payload's `update({ where })` reads the matching ids and then updates each
   * one, so two runners could both see `pending`. Instead:
   * - MongoDB: the adapter's `updateOne` with a `where` is a single
   *   `findOneAndUpdate`, which matches and writes atomically.
   * - SQL adapters (Postgres, SQLite): one `UPDATE ... WHERE status = 'pending'
   *   RETURNING id` statement through the adapter's `execute`.
   * - Any other adapter: a conditional `payload.update`, which is best-effort
   *   under concurrency. Errors there are thrown, never read as "claimed".
   */
  private async claimPendingRun(runId: number | string, req: PayloadRequest): Promise<boolean> {
    const db = this.payload.db as unknown as {
      drizzle?: unknown
      execute?: (args: { db?: unknown; drizzle?: unknown; raw: string }) => Promise<unknown>
      name?: string
      schemaName?: string
      sessions?: Record<string, { db?: unknown }>
      tableNameMap?: Map<string, string>
    }

    if (db.name === 'mongoose') {
      const claimed = await this.payload.db.updateOne({
        collection: 'workflow-runs',
        data: { status: 'running' },
        req,
        where: {
          and: [
            { id: { equals: runId } },
            { status: { equals: 'pending' } }
          ]
        }
      })
      return claimed !== null
    }

    if (db.drizzle && typeof db.execute === 'function' && db.tableNameMap) {
      // The id is inlined into raw SQL, so only accept plain numeric or
      // uuid/text ids made of safe characters.
      const idText = String(runId)
      if (!/^[\w-]+$/.test(idText)) {
        throw new Error(`Unexpected workflow run id: ${idText}`)
      }
      const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
      const tableName = db.tableNameMap.get('workflow_runs') ?? 'workflow_runs'
      const table = db.schemaName ? `${quote(db.schemaName)}.${quote(tableName)}` : quote(tableName)
      const idLiteral = typeof runId === 'number' ? idText : `'${idText}'`

      // Run inside the request's transaction when there is one, so the claim
      // does not wait on a lock that same transaction holds.
      const transactionID = req.transactionID instanceof Promise ? await req.transactionID : req.transactionID
      const session = transactionID !== undefined ? db.sessions?.[String(transactionID)]?.db : undefined

      const result = await db.execute({
        db: session,
        drizzle: db.drizzle,
        raw: `UPDATE ${table} SET "status" = 'running' WHERE "id" = ${idLiteral} AND "status" = 'pending' RETURNING "id"`
      }) as { rows?: unknown[] } | undefined
      return (result?.rows?.length ?? 0) > 0
    }

    const claimed = await this.payload.update({
      collection: 'workflow-runs',
      data: { status: 'running' },
      req,
      where: {
        and: [
          { id: { equals: runId } },
          { status: { equals: 'pending' } }
        ]
      }
    })
    if (claimed.errors.length > 0) {
      throw new Error(`Could not claim workflow run ${String(runId)}: ${claimed.errors.map((e) => e.message).join('; ')}`)
    }
    return claimed.docs.length > 0
  }

  private pendingStepResults(resolvedSteps: ResolvedStep[]): StepResult[] {
    return resolvedSteps.map((step) => ({
      step: step.stepId,
      slug: step.slug,
      stepName: step.stepName,
      stepIndex: step.stepIndex,
      status: 'pending'
    }))
  }

  /**
   * Value stored in `workflow-runs.triggeredBy`. With `stripUserData` the
   * user's email is replaced by a `<collection>:<id>` reference so the run
   * record holds no personal data about who triggered it.
   */
  private describeTriggeredBy(user?: { collection?: string; email?: string; id?: number | string } | null): string {
    if (!user) {
      return 'system'
    }
    if (this.config.stripUserData) {
      return user.id !== undefined ? `${user.collection ?? 'user'}:${user.id}` : 'user'
    }
    return user.email || 'system'
  }

  /**
   * Run the resolved steps batch by batch and record progress on the run.
   *
   * `options.startedAt` is when the run started (epoch ms); the workflow's
   * `timeout` counts from there, so for a run resumed after a deferred retry
   * the waiting time counts too. `options.resumeFrom` holds the step results
   * stored when the run was suspended. `options.canDefer` allows suspending
   * the run for a long retry delay; it requires the caller to be the
   * queued-run job, because resuming needs a job runner.
   */
  private async runSteps(
    workflow: PayloadWorkflow,
    context: ExecutionContext,
    req: PayloadRequest,
    workflowRun: { id: number | string; logs?: unknown[] | null },
    resolvedSteps: ResolvedStep[],
    firedTriggerId: number | string | undefined,
    options: {
      canDefer?: boolean
      keepRun?: boolean
      onRunDiscarded?: (workflowRunId: number | string) => void
      resumeFrom?: PreviousStepResult[]
      reuseSucceededSteps?: PreviousStepResult[]
      startedAt: number
    }
  ): Promise<void> {
    const { resumeFrom, reuseSucceededSteps } = options
    const stepResults = this.pendingStepResults(resolvedSteps)
    // Claim every step's slug before any batch runs, so a display-name alias
    // can never take another step's slug key (see setStepContext). Done here
    // so inline, queued and retried runs all get it.
    this.seedStepContextOwners(context, resolvedSteps)

    // Create job metadata for tracking workflow context in payload-jobs
    const jobMeta: WorkflowJobMeta = {
      automationWorkflowId: workflow.id,
      automationWorkflowRunId: workflowRun.id,
      automationTriggerId: firedTriggerId,
    }

    const run: RunState = {
      abort: new AbortController(),
      canDefer: options.canDefer === true,
      closed: false,
      inFlight: new Map(),
      logs: [],
      maxInProcessRetryDelay: nonNegativeInteger(
        this.config.execution?.maxInProcessRetryDelay,
        DEFAULT_MAX_IN_PROCESS_RETRY_DELAY_MS
      )
    }

    // The workflow's `timeout` limits the whole run. When it passes, the run
    // is closed first (so steps still in flight stop recording) and then the
    // batch being awaited is abandoned through `timedOut`. A timeout above
    // MAX_TIMER_MS (about 24.8 days) is enforced at that maximum.
    const timeoutMs = typeof workflow.timeout === 'number' && workflow.timeout > 0 ? workflow.timeout : undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let timedOut: Promise<never> | undefined
    if (timeoutMs !== undefined) {
      const remaining = options.startedAt + timeoutMs - Date.now()
      timedOut = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          run.closed = true
          run.abort.abort()
          reject(new WorkflowTimeoutError(timeoutMs))
        }, Math.min(Math.max(0, remaining), MAX_TIMER_MS))
      })
      // Awaited through Promise.race below; this handler only keeps a timeout
      // that fires between two batches from being an unhandled rejection.
      timedOut.catch(() => undefined)
    }

    try {
      if (timeoutMs !== undefined && Date.now() >= options.startedAt + timeoutMs) {
        // A resumed run whose retry wait outlasted the timeout.
        throw new WorkflowTimeoutError(timeoutMs)
      }

      const executionBatches = this.resolveExecutionOrder(resolvedSteps)
      // Slugs of steps whose earlier result was reused (see findReusableResult).
      const reusedSlugs = new Set<string>()
      // Slugs of steps that failed, or were skipped because a step they depend
      // on failed. Only populated with errorHandling 'continue', since
      // 'stop' and 'retry' end the run at the first failed step.
      const unavailableSlugs = new Map<string, 'failed' | 'skipped'>()

      this.logger.info({
        batchCount: executionBatches.length,
        batchSizes: executionBatches.map(b => b.length)
      }, 'Resolved step execution order')

      for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex++) {
        const batch = executionBatches[batchIndex]

        if (run.closed && timeoutMs !== undefined) {
          // The timeout fired while the previous batch was being saved.
          throw new WorkflowTimeoutError(timeoutMs)
        }

        this.logger.info({
          batchIndex,
          stepCount: batch.length,
          stepNames: batch.map(s => s.stepName)
        }, 'Executing batch')

        const batchPromises = batch.map(async (step) => {
          const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
          const record = (result: StepResult): StepResult => {
            if (idx !== -1) {
              stepResults[idx] = result
            }
            return result
          }

          // A step that finished before the run was suspended keeps its result.
          const stored = this.findStoredResult(step, resumeFrom)
          const restored = stored && this.restoreStepResult(step, stored, context)
          if (restored) {
            if (restored.status === 'failed' || (restored.status === 'skipped' && !step.condition)) {
              // Without a condition, a step can only have been skipped because
              // a step it depends on failed.
              unavailableSlugs.set(step.slug, restored.status)
            }
            return record(restored)
          }

          const skipped = this.skipForFailedDependency(step, context, unavailableSlugs)
          if (skipped) {
            unavailableSlugs.set(step.slug, 'skipped')
            return record(skipped)
          }

          const reusable = this.findReusableResult(step, reuseSucceededSteps, reusedSlugs)
          if (reusable) {
            const now = new Date().toISOString()
            const reused: StepResult = {
              step: step.stepId,
              slug: step.slug,
              stepName: step.stepName,
              stepIndex: step.stepIndex,
              status: 'succeeded',
              startedAt: now,
              completedAt: now,
              duration: 0,
              // Results stored before secret stripping existed may still
              // carry secrets, so clean them again before reuse.
              input: this.sanitizeStepData(reusable.input ?? undefined),
              output: this.sanitizeStepData(reusable.output ?? {})
            }
            this.setStepContext(context, step, {
              state: 'succeeded',
              input: reused.input,
              output: reused.output
            })
            reusedSlugs.add(step.slug)
            this.logger.info({ stepName: step.stepName }, 'Reusing succeeded step result from the earlier run')
            return record(reused)
          }

          // A stored result that is still pending but has attempts is a step
          // waiting for a deferred retry: continue its attempt count.
          const resume: StepResume | undefined = stored && (stored.attempts ?? 0) > 0
            ? {
                attempts: stored.attempts ?? 0,
                lastError: stored.lastError ?? undefined,
                notBefore: stored.nextRetryAt ? new Date(stored.nextRetryAt).getTime() : undefined,
                startedAt: stored.startedAt ?? undefined
              }
            : undefined

          let result: StepResult
          try {
            result = await this.executeStep(step, context, req, jobMeta, run, resume)
          } catch (error) {
            // executeStep reports failed attempts in its result; this is an
            // error outside an attempt (e.g. while resolving the input).
            result = {
              ...stepResults[idx],
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              completedAt: new Date().toISOString()
            }
          }

          if (run.closed) {
            // The run was already recorded as timed out or failed; this
            // step's late outcome must not overwrite what was stored.
            return undefined
          }
          record(result)

          if (result.status === 'failed') {
            unavailableSlugs.set(step.slug, 'failed')
            if (workflow.errorHandling === 'stop' || workflow.errorHandling === 'retry') {
              throw new Error(result.error)
            }
            this.logger.warn({
              stepName: step.stepName,
              error: result.error
            }, 'Step failed but continuing due to error handling setting')
          }
          return result
        })

        await (timedOut ? Promise.race([Promise.all(batchPromises), timedOut]) : Promise.all(batchPromises))

        const waiting = stepResults.filter((result) => result.status === 'pending' && result.nextRetryAt)
        if (waiting.length > 0) {
          await this.suspendForRetry(workflowRun, stepResults, waiting, context, run, req)
          return
        }

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

      // Nothing may change the results while the run is being completed.
      run.closed = true

      if (!options.keepRun && await this.shouldDiscardRun(workflow, context, stepResults)) {
        if (await this.discardRun(workflow, workflowRun.id, req)) {
          options.onRunDiscarded?.(workflowRun.id)
          return
        }
        // The run could not be deleted; store it as completed like any other.
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
            ...run.logs,
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
      // Close the run before anything is awaited: steps of the failed batch
      // may still be running or waiting to retry, and must not retry again or
      // change `stepResults` and the context while they are being saved.
      run.closed = true
      run.abort.abort()

      const errorMessage = describeError(error)

      // A step that was waiting for a deferred retry will not get it.
      for (const result of stepResults) {
        if (result.nextRetryAt) {
          result.nextRetryAt = null
        }
      }

      if (error instanceof WorkflowTimeoutError) {
        // Fail the steps that were running when the time ran out. Their task
        // handlers cannot be interrupted; cancelling the job only makes
        // Payload discard its result and never run it again.
        const completedAt = new Date().toISOString()
        for (const { jobId, result, step } of run.inFlight.values()) {
          const stepError = `Step timed out: the workflow exceeded its timeout of ${error.timeoutMs} ms while this step was running`
          const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
          if (idx !== -1) {
            stepResults[idx] = {
              ...result,
              status: 'failed',
              error: stepError,
              lastError: stepError,
              nextRetryAt: null,
              completedAt,
              duration: new Date(completedAt).getTime() - new Date(result.startedAt ?? completedAt).getTime()
            }
          }
          this.setStepContext(context, step, { state: 'failed', input: result.input, error: stepError })
          if (jobId !== undefined) {
            await this.cancelJob(jobId, req)
          }
        }
      }

      await this.recordRunFailure(
        workflowRun.id,
        errorMessage,
        {
          stepResults,
          context: this.safeSerialize(context),
          logs: [
            ...(workflowRun.logs || []),
            ...run.logs,
            {
              timestamp: new Date().toISOString(),
              level: 'error',
              message: `Workflow execution failed: ${errorMessage}`
            }
          ]
        },
        req
      )

      this.logger.error({
        workflowRunId: workflowRun.id,
        workflowId: workflow.id,
        error: errorMessage
      }, 'Workflow execution failed')

      throw error
    } finally {
      clearTimeout(timeoutTimer)
    }
  }

  /**
   * Store a run as `failed`, falling back to smaller writes when the full one
   * is rejected, and never throw.
   *
   * The write that records a failure can itself fail: the step results may no
   * longer validate (for example a step document was deleted while the run
   * was in progress), or a host hook on `workflow-runs` may reject the data.
   * It is often the very write whose failure ended the run. If that error
   * escaped, the run would stay `running` forever with nothing in the admin
   * UI explaining why, and it would hide the error that actually failed the
   * run from the caller. So, in order:
   * 1. the full write with `details` (step results, context, logs);
   * 2. only `status`, `completedAt` and `error` through the Local API, which
   *    still runs hooks but does not send the data that was rejected;
   * 3. the same three fields straight through the database adapter, which
   *    skips validation and hooks, for when a hook rejects every update.
   * The stored `error` then also says that the details are missing and why.
   * If nothing can be written (the database is unreachable), that is logged
   * and the caller carries on with the original error.
   */
  private async recordRunFailure(
    workflowRunId: number | string,
    errorMessage: string,
    details: Record<string, unknown>,
    req: PayloadRequest
  ): Promise<void> {
    const completedAt = new Date().toISOString()
    let writeError: unknown
    try {
      await this.payload.update({
        id: workflowRunId,
        collection: 'workflow-runs',
        data: { ...details, status: 'failed', completedAt, error: errorMessage },
        req
      })
      return
    } catch (error) {
      writeError = error
    }

    const minimal = {
      status: 'failed',
      completedAt,
      error: `${errorMessage}\n\nThe step results, context and logs of this run could not be stored: ${describeError(writeError)}`
    }
    this.logger.warn({
      workflowRunId,
      error: describeError(writeError)
    }, 'Could not store the details of a failed workflow run; storing only its status and error')

    try {
      await this.payload.update({ id: workflowRunId, collection: 'workflow-runs', data: minimal, req })
      return
    } catch {
      // Reported through the adapter write below, or its own failure.
    }

    try {
      await this.payload.db.updateOne({
        id: workflowRunId,
        collection: 'workflow-runs',
        data: minimal,
        req,
        returning: false
      })
    } catch (error) {
      this.logger.error({
        workflowRunId,
        error: describeError(error),
        runError: errorMessage
      }, 'Could not mark a failed workflow run as failed; it keeps its previous status')
    }
  }

  /**
   * Whether a run that reached its end should be deleted instead of stored,
   * as decided by the workflow's `discardRunWhen` expression.
   *
   * A workflow that polls for work (a scheduled trigger whose step usually
   * finds nothing) would otherwise add a run to the history on every tick and
   * bury the runs that did something. The expression is evaluated against the
   * finished run's context, so it can look at step outputs and states, which
   * a trigger condition cannot: that runs before any step.
   *
   * A run with a failed step is never discarded, also when it completed
   * because of `errorHandling: 'continue'`: failures must stay visible.
   * An expression that cannot be evaluated counts as false, so a mistake in
   * it keeps runs rather than losing them.
   */
  private async shouldDiscardRun(
    workflow: PayloadWorkflow,
    context: ExecutionContext,
    stepResults: StepResult[]
  ): Promise<boolean> {
    const expression = typeof workflow.discardRunWhen === 'string' ? workflow.discardRunWhen.trim() : ''
    if (!expression) {
      return false
    }
    if (stepResults.some((result) => result.status === 'failed')) {
      return false
    }
    return this.evaluateCondition(expression, context)
  }

  /**
   * Delete a finished run that `shouldDiscardRun` selected. Returns false,
   * after logging why, when the delete failed; the caller then stores the run
   * normally, because a run stuck in `running` would be worse than an extra
   * entry in the history.
   */
  private async discardRun(
    workflow: PayloadWorkflow,
    workflowRunId: number | string,
    req: PayloadRequest
  ): Promise<boolean> {
    try {
      await this.payload.delete({ collection: 'workflow-runs', id: workflowRunId, req })
    } catch (error) {
      this.logger.warn({
        workflowRunId,
        workflowId: workflow.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Could not delete a workflow run selected by discardRunWhen; keeping it')
      return false
    }
    this.logger.info({
      workflowRunId,
      workflowId: workflow.id
    }, 'Workflow execution completed; run discarded because discardRunWhen was true')
    return true
  }

  /**
   * The result stored for `step` when the run was suspended, if any. Matched
   * like a reusable result: same position, same step document and same slug,
   * so a workflow edited while the run waited runs the changed steps afresh.
   */
  private findStoredResult(
    step: ResolvedStep,
    stored: PreviousStepResult[] | undefined
  ): PreviousStepResult | undefined {
    return stored?.find((candidate) =>
      candidate.stepIndex === step.stepIndex &&
      String(relationId(candidate.step)) === String(step.stepId) &&
      candidate.slug === step.slug
    )
  }

  /**
   * Rebuild the result and the expression context of a step that had already
   * finished (succeeded, failed or skipped) before the run was suspended.
   * Returns undefined for a step that still has to run.
   */
  private restoreStepResult(
    step: ResolvedStep,
    stored: PreviousStepResult,
    context: ExecutionContext
  ): StepResult | undefined {
    if (stored.status !== 'succeeded' && stored.status !== 'failed' && stored.status !== 'skipped') {
      return undefined
    }
    const result: StepResult = {
      step: step.stepId,
      slug: step.slug,
      stepName: step.stepName,
      stepIndex: step.stepIndex,
      status: stored.status,
      startedAt: stored.startedAt ?? undefined,
      completedAt: stored.completedAt ?? undefined,
      duration: stored.duration ?? undefined,
      input: stored.input ?? undefined,
      output: stored.output ?? undefined,
      error: stored.error ?? undefined,
      attempts: stored.attempts ?? undefined,
      retryCount: Math.max(0, (stored.attempts ?? 0) - 1),
      lastError: stored.lastError ?? undefined,
      nextRetryAt: null
    }
    this.setStepContext(context, step, {
      state: result.status,
      ...(result.input !== undefined ? { input: result.input } : {}),
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.error !== undefined ? { error: result.error } : {})
    })
    return result
  }

  /**
   * Pause a queued run whose step has to wait longer for its next attempt
   * than the run may sleep in-process.
   *
   * Instead of holding a job-runner slot for the whole delay, the run is
   * saved with status `pending` and a new `WORKFLOW_RUN_TASK_SLUG` job is
   * queued with Payload's `waitUntil` set to the earliest due retry. When a
   * job runner picks that job up, `executeQueuedRun` continues the run from
   * the stored step results.
   */
  private async suspendForRetry(
    workflowRun: { id: number | string; logs?: unknown[] | null },
    stepResults: StepResult[],
    waiting: StepResult[],
    context: ExecutionContext,
    run: RunState,
    req: PayloadRequest
  ): Promise<void> {
    // No step is in flight here (the batch has settled); closing the run
    // documents that this call of runSteps records nothing further.
    run.closed = true

    const resumeAt = new Date(Math.min(...waiting.map((result) => new Date(result.nextRetryAt!).getTime())))
    const names = waiting.map((result) => `"${result.stepName}"`).join(', ')

    await this.payload.update({
      id: workflowRun.id,
      collection: 'workflow-runs',
      data: {
        status: 'pending',
        stepResults,
        context: this.safeSerialize(context),
        logs: [
          ...(workflowRun.logs || []),
          ...run.logs,
          {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Workflow run paused until ${resumeAt.toISOString()} to retry ${names}`
          }
        ]
      },
      req
    })

    const queue = this.config.execution?.queue
    await this.payload.jobs.queue({
      input: { workflowRunId: String(workflowRun.id) },
      ...(queue ? { queue } : {}),
      req,
      task: WORKFLOW_RUN_TASK_SLUG,
      waitUntil: resumeAt
    })

    this.logger.info({
      resumeAt: resumeAt.toISOString(),
      steps: waiting.map((result) => result.stepName),
      workflowRunId: workflowRun.id
    }, 'Workflow run paused for a deferred step retry')
  }
}
