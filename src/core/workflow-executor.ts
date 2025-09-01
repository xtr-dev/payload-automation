import type { Payload, PayloadRequest } from 'payload'

// We need to reference the generated types dynamically since they're not available at build time
// Using generic types and casting where necessary
export type PayloadWorkflow = {
  id: number
  name: string
  description?: string | null
  triggers?: Array<{
    type?: string | null
    collectionSlug?: string | null
    operation?: string | null
    condition?: string | null
    [key: string]: unknown
  }> | null
  steps?: Array<{
    step?: string | null
    name?: string | null
    input?: unknown
    dependencies?: string[] | null
    condition?: string | null
    [key: string]: unknown
  }> | null
  [key: string]: unknown
}

import { JSONPath } from 'jsonpath-plus'

// Helper type to extract workflow step data from the generated types
export type WorkflowStep = NonNullable<PayloadWorkflow['steps']>[0] & {
  name: string // Ensure name is always present for our execution logic
}

// Helper type to extract workflow trigger data from the generated types  
export type WorkflowTrigger = NonNullable<PayloadWorkflow['triggers']>[0] & {
  type: string // Ensure type is always present for our execution logic
}

export interface ExecutionContext {
  steps: Record<string, {
    error?: string
    input: unknown
    output: unknown
    state: 'failed' | 'pending' | 'running' | 'succeeded'
  }>
  trigger: {
    collection?: string
    data?: unknown
    doc?: unknown
    headers?: Record<string, string>
    operation?: string
    path?: string
    previousDoc?: unknown
    req?: PayloadRequest
    triggeredAt?: string
    type: string
    user?: {
      collection?: string
      email?: string
      id?: string
    }
  }
}

export class WorkflowExecutor {
  constructor(
    private payload: Payload,
    private logger: Payload['logger']
  ) {}

  /**
   * Evaluate a step condition using JSONPath
   */
  private evaluateStepCondition(condition: string, context: ExecutionContext): boolean {
    return this.evaluateCondition(condition, context)
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    stepIndex: number,
    context: ExecutionContext,
    req: PayloadRequest,
    workflowRunId?: number | string
  ): Promise<void> {
    const stepName = step.name || 'step-' + stepIndex

    this.logger.info({
      hasStep: 'step' in step,
      step: JSON.stringify(step),
      stepName
    }, 'Executing step')

    // Check step condition if present
    if (step.condition) {
      this.logger.debug({
        condition: step.condition,
        stepName,
        availableSteps: Object.keys(context.steps),
        completedSteps: Object.entries(context.steps)
          .filter(([_, s]) => s.state === 'succeeded')
          .map(([name]) => name),
        triggerType: context.trigger?.type
      }, 'Evaluating step condition')

      const conditionMet = this.evaluateStepCondition(step.condition, context)

      if (!conditionMet) {
        this.logger.info({
          condition: step.condition,
          stepName,
          contextSnapshot: JSON.stringify({
            stepOutputs: Object.entries(context.steps).reduce((acc, [name, step]) => {
              acc[name] = { state: step.state, hasOutput: !!step.output }
              return acc
            }, {} as Record<string, any>),
            triggerData: context.trigger?.data ? 'present' : 'absent'
          })
        }, 'Step condition not met, skipping')

        // Mark step as completed but skipped
        context.steps[stepName] = {
          error: undefined,
          input: undefined,
          output: { reason: 'Condition not met', skipped: true },
          state: 'succeeded'
        }

        // Update workflow run context if needed
        if (workflowRunId) {
          await this.updateWorkflowRunContext(workflowRunId, context, req)
        }

        return
      }

      this.logger.info({
        condition: step.condition,
        stepName,
        contextSnapshot: JSON.stringify({
          stepOutputs: Object.entries(context.steps).reduce((acc, [name, step]) => {
            acc[name] = { state: step.state, hasOutput: !!step.output }
            return acc
          }, {} as Record<string, any>),
          triggerData: context.trigger?.data ? 'present' : 'absent'
        })
      }, 'Step condition met, proceeding with execution')
    }

    // Initialize step context
    context.steps[stepName] = {
      error: undefined,
      input: undefined,
      output: undefined,
      state: 'running'
    }

    // Move taskSlug declaration outside try block so it's accessible in catch
    const taskSlug = step.step // Use the 'step' field for task type

    try {
      // Resolve input data using JSONPath
      const resolvedInput = this.resolveStepInput(step.input as Record<string, unknown> || {}, context)
      context.steps[stepName].input = resolvedInput

      if (!taskSlug) {
        throw new Error(`Step ${stepName} is missing a task type`)
      }

      this.logger.info({
        hasInput: !!resolvedInput,
        hasReq: !!req,
        stepName,
        taskSlug
      }, 'Queueing task')

      const job = await this.payload.jobs.queue({
        input: resolvedInput,
        req,
        task: taskSlug
      })

      // Run the job immediately
      await this.payload.jobs.run({
        limit: 1,
        req
      })

      // Get the job result
      const completedJob = await this.payload.findByID({
        id: job.id,
        collection: 'payload-jobs',
        req
      })

      const taskStatus = completedJob.taskStatus?.[completedJob.taskSlug]?.[completedJob.totalTried]
      const isComplete = taskStatus?.complete === true
      const hasError = completedJob.hasError || !isComplete

      // Extract error information from job if available
      let errorMessage: string | undefined
      if (hasError) {
        // Try to get error from the latest log entry
        if (completedJob.log && completedJob.log.length > 0) {
          const latestLog = completedJob.log[completedJob.log.length - 1]
          errorMessage = latestLog.error?.message || latestLog.error
        }

        // Fallback to top-level error
        if (!errorMessage && completedJob.error) {
          errorMessage = completedJob.error.message || completedJob.error
        }

        // Final fallback to generic message
        if (!errorMessage) {
          errorMessage = `Task ${taskSlug} failed without detailed error information`
        }
      }

      const result: {
        error: string | undefined
        output: unknown
        state: 'failed' | 'succeeded'
      } = {
        error: errorMessage,
        output: taskStatus?.output || {},
        state: isComplete ? 'succeeded' : 'failed'
      }

      // Store the output and error
      context.steps[stepName].output = result.output
      context.steps[stepName].state = result.state
      if (result.error) {
        context.steps[stepName].error = result.error
      }

      this.logger.debug({context}, 'Step execution context')

      if (result.state !== 'succeeded') {
        throw new Error(result.error || `Step ${stepName} failed`)
      }

      this.logger.info({
        output: result.output,
        stepName
      }, 'Step completed')

      // Update workflow run with current step results if workflowRunId is provided
      if (workflowRunId) {
        await this.updateWorkflowRunContext(workflowRunId, context, req)
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      context.steps[stepName].state = 'failed'
      context.steps[stepName].error = errorMessage

      this.logger.error({
        error: errorMessage,
        input: context.steps[stepName].input,
        stepName,
        taskSlug
      }, 'Step execution failed')

      // Update workflow run with current step results if workflowRunId is provided
      if (workflowRunId) {
        try {
          await this.updateWorkflowRunContext(workflowRunId, context, req)
        } catch (updateError) {
          this.logger.error({
            error: updateError instanceof Error ? updateError.message : 'Unknown error',
            stepName
          }, 'Failed to update workflow run context after step failure')
        }
      }

      throw error
    }
  }

  /**
   * Resolve step execution order based on dependencies
   */
  private resolveExecutionOrder(steps: WorkflowStep[]): WorkflowStep[][] {
    const stepMap = new Map<string, WorkflowStep>()
    const dependencyGraph = new Map<string, string[]>()
    const indegree = new Map<string, number>()

    // Build the step map and dependency graph
    for (const step of steps) {
      const stepName = step.name || `step-${steps.indexOf(step)}`
      const dependencies = step.dependencies || []

      stepMap.set(stepName, { ...step, name: stepName, dependencies })
      dependencyGraph.set(stepName, dependencies)
      indegree.set(stepName, dependencies.length)
    }

    // Topological sort to determine execution batches
    const executionBatches: WorkflowStep[][] = []
    const processed = new Set<string>()

    while (processed.size < steps.length) {
      const currentBatch: WorkflowStep[] = []

      // Find all steps with no remaining dependencies
      for (const [stepName, inDegree] of indegree.entries()) {
        if (inDegree === 0 && !processed.has(stepName)) {
          const step = stepMap.get(stepName)
          if (step) {
            currentBatch.push(step)
          }
        }
      }

      if (currentBatch.length === 0) {
        throw new Error('Circular dependency detected in workflow steps')
      }

      executionBatches.push(currentBatch)

      // Update indegrees for next iteration
      for (const step of currentBatch) {
        processed.add(step.name)

        // Reduce indegree for steps that depend on completed steps
        for (const [otherStepName, dependencies] of dependencyGraph.entries()) {
          if (dependencies.includes(step.name) && !processed.has(otherStepName)) {
            indegree.set(otherStepName, (indegree.get(otherStepName) || 0) - 1)
          }
        }
      }
    }

    return executionBatches
  }

  /**
   * Resolve step input using JSONPath expressions
   */
  private resolveStepInput(config: Record<string, unknown>, context: ExecutionContext): Record<string, unknown> {
    const resolved: Record<string, unknown> = {}

    this.logger.debug({
      configKeys: Object.keys(config),
      contextSteps: Object.keys(context.steps),
      triggerType: context.trigger?.type
    }, 'Starting step input resolution')

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        // This is a JSONPath expression
        this.logger.debug({
          key,
          jsonPath: value,
          availableSteps: Object.keys(context.steps),
          hasTriggerData: !!context.trigger?.data,
          hasTriggerDoc: !!context.trigger?.doc
        }, 'Resolving JSONPath expression')

        try {
          const result = JSONPath({
            json: context,
            path: value,
            wrap: false
          })
          
          this.logger.debug({
            key,
            jsonPath: value,
            result: JSON.stringify(result).substring(0, 200),
            resultType: Array.isArray(result) ? 'array' : typeof result
          }, 'JSONPath resolved successfully')
          
          resolved[key] = result
        } catch (error) {
          this.logger.warn({
            error: error instanceof Error ? error.message : 'Unknown error',
            key,
            path: value,
            contextSnapshot: JSON.stringify(context).substring(0, 500)
          }, 'Failed to resolve JSONPath')
          resolved[key] = value // Keep original value if resolution fails
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively resolve nested objects
        this.logger.debug({
          key,
          nestedKeys: Object.keys(value as Record<string, unknown>)
        }, 'Recursively resolving nested object')
        
        resolved[key] = this.resolveStepInput(value as Record<string, unknown>, context)
      } else {
        // Keep literal values as-is
        resolved[key] = value
      }
    }

    this.logger.debug({
      resolvedKeys: Object.keys(resolved),
      originalKeys: Object.keys(config)
    }, 'Step input resolution completed')

    return resolved
  }

  /**
   * Safely serialize an object, handling circular references and non-serializable values
   */
  private safeSerialize(obj: unknown): unknown {
    const seen = new WeakSet()
    
    const serialize = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object') {
        return value
      }
      
      if (seen.has(value as object)) {
        return '[Circular Reference]'
      }
      
      seen.add(value as object)
      
      if (Array.isArray(value)) {
        return value.map(serialize)
      }
      
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        try {
          // Skip non-serializable properties that are likely internal database objects
          if (key === 'table' || key === 'schema' || key === '_' || key === '__') {
            continue
          }
          result[key] = serialize(val)
        } catch {
          // Skip properties that can't be accessed or serialized
          result[key] = '[Non-serializable]'
        }
      }
      
      return result
    }
    
    return serialize(obj)
  }

  /**
   * Update workflow run with current context
   */
  private async updateWorkflowRunContext(
    workflowRunId: number | string,
    context: ExecutionContext,
    req: PayloadRequest
  ): Promise<void> {
    const serializeContext = () => ({
      steps: this.safeSerialize(context.steps),
      trigger: {
        type: context.trigger.type,
        collection: context.trigger.collection,
        data: this.safeSerialize(context.trigger.data),
        doc: this.safeSerialize(context.trigger.doc),
        operation: context.trigger.operation,
        previousDoc: this.safeSerialize(context.trigger.previousDoc),
        triggeredAt: context.trigger.triggeredAt,
        user: context.trigger.req?.user
      }
    })

    await this.payload.update({
      id: workflowRunId,
      collection: 'workflow-runs',
      data: {
        context: serializeContext()
      },
      req
    })
  }

  /**
   * Evaluate a condition using JSONPath
   */
  public evaluateCondition(condition: string, context: ExecutionContext): boolean {
    this.logger.debug({
      condition,
      contextKeys: Object.keys(context),
      triggerType: context.trigger?.type,
      triggerData: context.trigger?.data,
      triggerDoc: context.trigger?.doc ? 'present' : 'absent'
    }, 'Starting condition evaluation')

    try {
      const result = JSONPath({
        json: context,
        path: condition,
        wrap: false
      })

      this.logger.debug({
        condition,
        result,
        resultType: Array.isArray(result) ? 'array' : typeof result,
        resultLength: Array.isArray(result) ? result.length : undefined
      }, 'JSONPath evaluation result')

      // Handle different result types
      let finalResult: boolean
      if (Array.isArray(result)) {
        finalResult = result.length > 0 && Boolean(result[0])
      } else {
        finalResult = Boolean(result)
      }

      this.logger.debug({
        condition,
        finalResult,
        originalResult: result
      }, 'Condition evaluation completed')

      return finalResult
    } catch (error) {
      this.logger.warn({
        condition,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'Failed to evaluate condition')

      // If condition evaluation fails, assume false
      return false
    }
  }

  /**
   * Execute a workflow with the given context
   */
  async execute(workflow: PayloadWorkflow, context: ExecutionContext, req: PayloadRequest): Promise<void> {
    this.logger.info({
      workflowId: workflow.id,
      workflowName: workflow.name
    }, 'Starting workflow execution')

    const serializeContext = () => ({
      steps: this.safeSerialize(context.steps),
      trigger: {
        type: context.trigger.type,
        collection: context.trigger.collection,
        data: this.safeSerialize(context.trigger.data),
        doc: this.safeSerialize(context.trigger.doc),
        operation: context.trigger.operation,
        previousDoc: this.safeSerialize(context.trigger.previousDoc),
        triggeredAt: context.trigger.triggeredAt,
        user: context.trigger.req?.user
      }
    })

    // Create a workflow run record
    const workflowRun = await this.payload.create({
      collection: 'workflow-runs',
      data: {
        context: serializeContext(),
        startedAt: new Date().toISOString(),
        status: 'running',
        triggeredBy: context.trigger.req?.user?.email || 'system',
        workflow: workflow.id,
        workflowVersion: 1 // Default version since generated type doesn't have _version field
      },
      req
    })

    try {
      // Resolve execution order based on dependencies
      const executionBatches = this.resolveExecutionOrder(workflow.steps as WorkflowStep[] || [])

      this.logger.info({
        batchSizes: executionBatches.map(batch => batch.length),
        totalBatches: executionBatches.length
      }, 'Resolved step execution order')

      // Execute each batch in sequence, but steps within each batch in parallel
      for (let batchIndex = 0; batchIndex < executionBatches.length; batchIndex++) {
        const batch = executionBatches[batchIndex]

        this.logger.info({
          batchIndex,
          stepCount: batch.length,
          stepNames: batch.map(s => s.name)
        }, 'Executing batch')

        // Execute all steps in this batch in parallel
        const batchPromises = batch.map((step, stepIndex) =>
          this.executeStep(step, stepIndex, context, req, workflowRun.id)
        )

        // Wait for all steps in the current batch to complete
        await Promise.all(batchPromises)

        this.logger.info({
          batchIndex,
          stepCount: batch.length
        }, 'Batch completed')
      }

      // Update workflow run as completed
      await this.payload.update({
        id: workflowRun.id,
        collection: 'workflow-runs',
        data: {
          completedAt: new Date().toISOString(),
          context: serializeContext(),
          status: 'completed'
        },
        req
      })

      this.logger.info({
        runId: workflowRun.id,
        workflowId: workflow.id,
        workflowName: workflow.name
      }, 'Workflow execution completed')

    } catch (error) {
      // Update workflow run as failed
      await this.payload.update({
        id: workflowRun.id,
        collection: 'workflow-runs',
        data: {
          completedAt: new Date().toISOString(),
          context: serializeContext(),
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'failed'
        },
        req
      })

      this.logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        runId: workflowRun.id,
        workflowId: workflow.id,
        workflowName: workflow.name
      }, 'Workflow execution failed')

      throw error
    }
  }

  /**
   * Find and execute workflows triggered by a collection operation
   */
  async executeTriggeredWorkflows(
    collection: string,
    operation: 'create' | 'delete' | 'read' | 'update',
    doc: unknown,
    previousDoc: unknown,
    req: PayloadRequest
  ): Promise<void> {
    this.logger.info({
      collection,
      operation,
      docId: (doc as any)?.id
    }, 'executeTriggeredWorkflows called')
    
    try {
      // Find workflows with matching triggers
      const workflows = await this.payload.find({
        collection: 'workflows',
        depth: 2, // Include steps and triggers
        limit: 100,
        req
      })
      
      this.logger.info({
        workflowCount: workflows.docs.length
      }, 'Found workflows to check')

      for (const workflow of workflows.docs) {
        // Check if this workflow has a matching trigger
        const triggers = workflow.triggers as Array<{
          collection?: string
          collectionSlug?: string
          condition?: string
          operation: string
          type: string
        }>
        
        this.logger.debug({
          workflowId: workflow.id,
          workflowName: workflow.name,
          triggerCount: triggers?.length || 0,
          triggers: triggers?.map(t => ({
            type: t.type,
            collection: t.collection,
            collectionSlug: t.collectionSlug,
            operation: t.operation
          }))
        }, 'Checking workflow triggers')

        const matchingTriggers = triggers?.filter(trigger =>
          trigger.type === 'collection-trigger' &&
          (trigger.collection === collection || trigger.collectionSlug === collection) &&
          trigger.operation === operation
        ) || []
        
        this.logger.info({
          workflowId: workflow.id,
          workflowName: workflow.name,
          matchingTriggerCount: matchingTriggers.length,
          targetCollection: collection,
          targetOperation: operation
        }, 'Matching triggers found')

        for (const trigger of matchingTriggers) {
          // Create execution context for condition evaluation
          const context: ExecutionContext = {
            steps: {},
            trigger: {
              type: 'collection',
              collection,
              doc,
              operation,
              previousDoc,
              req
            }
          }

          // Check trigger condition if present
          if (trigger.condition) {
            this.logger.debug({
              collection,
              operation,
              condition: trigger.condition,
              docId: (doc as any)?.id,
              docFields: doc ? Object.keys(doc) : [],
              previousDocId: (previousDoc as any)?.id,
              workflowId: workflow.id,
              workflowName: workflow.name
            }, 'Evaluating collection trigger condition')

            const conditionMet = this.evaluateCondition(trigger.condition, context)

            if (!conditionMet) {
              this.logger.info({
                collection,
                condition: trigger.condition,
                operation,
                workflowId: workflow.id,
                workflowName: workflow.name,
                docSnapshot: JSON.stringify(doc).substring(0, 200)
              }, 'Trigger condition not met, skipping workflow')
              continue
            }

            this.logger.info({
              collection,
              condition: trigger.condition,
              operation,
              workflowId: workflow.id,
              workflowName: workflow.name,
              docSnapshot: JSON.stringify(doc).substring(0, 200)
            }, 'Trigger condition met')
          }

          this.logger.info({
            collection,
            operation,
            workflowId: workflow.id,
            workflowName: workflow.name
          }, 'Triggering workflow')

          // Execute the workflow
          await this.execute(workflow as PayloadWorkflow, context, req)
        }
      }
    } catch (error) {
      this.logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Workflow execution failed')
      this.logger.error({
        collection,
        error: error instanceof Error ? error.message : 'Unknown error',
        operation
      }, 'Failed to execute triggered workflows')
    }
  }
}
