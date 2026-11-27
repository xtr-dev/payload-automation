import type { Payload, PayloadRequest } from 'payload'

import {
  evaluateCondition as evalCondition,
  resolveStepInput as resolveInput,
  type ExpressionContext
} from './expression-engine.js'
import { expectStepOutput, releaseStepOutput } from './step-output-capture.js'
import {getPluginConfig} from "../plugin/get-plugin-config.js";
import {WorkflowsPluginConfig} from "../plugin/config-types.js";

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
      slug: step.slug,
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
    result.input = resolvedInput

    this.setStepContext(context, step, {
      state: 'running',
      input: resolvedInput
    })

    try {
      const job = await this.payload.jobs.queue({
        input: resolvedInput,
        req,
        task: step.stepType,
      })

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
      const jobSucceeded = jobStatus?.status === 'success'

      if (jobSucceeded) {
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

        result.status = 'succeeded'
        result.output = this.sanitizeStepData(output)
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

      this.setStepContext(context, step, {
        state: 'succeeded',
        input: resolvedInput,
        output: result.output
      })

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

      this.setStepContext(context, step, {
        state: 'failed',
        input: resolvedInput,
        error: errorMessage
      })

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

    const workflowRun = await this.payload.create({
      collection: 'workflow-runs',
      data: {
        workflow: workflow.id,
        workflowVersion: 1,
        firedTrigger: firedTrigger?.id,
        triggerData: this.safeSerialize(context.trigger),
        status: queued ? 'pending' : 'running',
        startedAt: new Date().toISOString(),
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
      options.reuseSucceededSteps
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
          startedAt: new Date().toISOString(),
          logs: [
            ...(workflowRun.logs || []),
            {
              timestamp: new Date().toISOString(),
              level: 'info',
              message: 'Workflow execution started'
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
      await this.payload.update({
        collection: 'workflow-runs',
        id: workflowRun.id,
        data: {
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: `Could not start queued workflow run: ${errorMessage}`
        },
        req
      })
      throw error
    }

    const context: ExecutionContext = {
      steps: {},
      trigger: (workflowRun.triggerData as ExecutionContext['trigger'] | null) ?? {}
    }

    await this.runSteps(workflow, context, req, startedRun, resolvedSteps, firedTriggerId)
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
   */
  private async runSteps(
    workflow: PayloadWorkflow,
    context: ExecutionContext,
    req: PayloadRequest,
    workflowRun: { id: number | string; logs?: unknown[] | null },
    resolvedSteps: ResolvedStep[],
    firedTriggerId?: number | string,
    reuseSucceededSteps?: PreviousStepResult[]
  ): Promise<void> {
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

    try {
      const executionBatches = this.resolveExecutionOrder(resolvedSteps)
      // Slugs of steps whose earlier result was reused (see findReusableResult).
      const reusedSlugs = new Set<string>()
      // Slugs of steps that failed, or were skipped because a step they depend
      // on failed. Only populated with errorHandling other than 'stop', since
      // 'stop' ends the run at the first failure.
      const unavailableSlugs = new Map<string, 'failed' | 'skipped'>()

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
          const skipped = this.skipForFailedDependency(step, context, unavailableSlugs)
          if (skipped) {
            unavailableSlugs.set(step.slug, 'skipped')
            const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
            if (idx !== -1) {
              stepResults[idx] = skipped
            }
            return skipped
          }
          try {
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
              const reusedIdx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
              if (reusedIdx !== -1) {
                stepResults[reusedIdx] = reused
              }
              reusedSlugs.add(step.slug)
              this.logger.info({ stepName: step.stepName }, 'Reusing succeeded step result from the earlier run')
              return reused
            }

            const result = await this.executeStep(step, context, req, stepResults, jobMeta)
            const idx = stepResults.findIndex(r => r.stepIndex === step.stepIndex)
            if (idx !== -1) {
              stepResults[idx] = result
            }
            return result
          } catch (error) {
            unavailableSlugs.set(step.slug, 'failed')
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
