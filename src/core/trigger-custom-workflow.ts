import type { Payload, PayloadRequest } from 'payload'

import { initializeLogger } from '../plugin/logger.js'
import { type PayloadWorkflow, WorkflowExecutor } from './workflow-executor.js'

export interface CustomTriggerOptions {
  /**
   * Data to pass to the workflow execution context
   */
  data?: Record<string, unknown>

  /**
   * Optional PayloadRequest to use for the workflow execution
   * If not provided, a minimal request will be created
   */
  req?: PayloadRequest

  /**
   * The trigger type to match. Defaults to `'manual'`, the type meant for
   * starting workflows from code. A trigger's type is one of the plugin's
   * built-in types (`manual`, `collection-hook`, `global-hook`, `scheduled`,
   * `webhook`); custom trigger types do not exist, so any other value matches
   * no workflow.
   */
  slug?: string

  /**
   * Optional user information for tracking who triggered the workflow
   */
  user?: {
    email?: string
    id?: string
  }
}

export interface TriggerResult {
  /**
   * `true` when the run finished and was deleted from `workflow-runs`
   * because the workflow's `discardRunWhen` expression was true. `runId` then
   * refers to a run that is no longer stored.
   */
  discarded?: boolean
  error?: string
  runId: number | string
  status: 'failed' | 'triggered'
  workflowId: string
  workflowName: string
}

/**
 * Starts every enabled workflow that has a trigger of type **Manual**.
 * Workflows with `enabled: false` are skipped. Resolves to one result per
 * workflow that was started; an empty array when none matched.
 *
 * @example
 * ```typescript
 * await triggerCustomWorkflow(payload, {
 *   data: {
 *     source: 'external-api',
 *     recordCount: 100,
 *     importedAt: new Date().toISOString()
 *   }
 * })
 * ```
 */
export async function triggerCustomWorkflow(
  payload: Payload,
  options: CustomTriggerOptions
): Promise<TriggerResult[]> {
  const { slug = 'manual', data = {}, req, user } = options

  const logger = initializeLogger(payload)

  logger.info({
    hasData: Object.keys(data).length > 0,
    hasUser: !!user,
    triggerSlug: slug
  }, 'Triggering custom workflow')

  try {
    // Find workflows with matching custom trigger
    const workflows = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100,
      where: {
        enabled: {
          equals: true
        },
        'triggers.type': {
          equals: slug
        }
      }
    })

    if (workflows.docs.length === 0) {
      logger.warn({
        triggerSlug: slug
      }, 'No workflows found for custom trigger')
      return []
    }

    logger.info({
      triggerSlug: slug,
      workflowCount: workflows.docs.length
    }, 'Found workflows for custom trigger')

    // Create a minimal request if not provided
    const workflowReq = req || {
      context: {},
      headers: new Headers(),
      payload,
      user: user ? {
        id: user.id,
        collection: 'users',
        email: user.email
      } : undefined
    } as PayloadRequest

    // Create workflow executor
    const executor = new WorkflowExecutor(payload, logger)

    // Execute all matching workflows
    const results: TriggerResult[] = []

    for (const workflow of workflows.docs) {
      // Set once the run record exists, so a failed run still reports its id.
      let createdRunId: number | string | undefined
      try {
        // Check if this workflow actually has the custom trigger
        const triggers = workflow.triggers as Array<{type: string}>
        const hasMatchingTrigger = triggers?.some(trigger => trigger.type === slug)

        if (!hasMatchingTrigger) {
          continue
        }

        logger.info({
          triggerSlug: slug,
          workflowId: workflow.id.toString(),
          workflowName: workflow.name
        }, 'Executing workflow with custom trigger')

        // Create execution context
        const context = {
          steps: {},
          trigger: {
            type: slug,
            data,
            triggeredAt: new Date().toISOString(),
            user: (user || workflowReq.user) ? {
              id: (user || workflowReq.user)?.id?.toString(),
              email: (user || workflowReq.user)?.email
            } : undefined
          }
        }

        // Execute the workflow
        let discarded = false
        const runId = await executor.execute(workflow as PayloadWorkflow, context, workflowReq, undefined, {
          onRunCreated: (id) => {
            createdRunId = id
          },
          onRunDiscarded: () => {
            discarded = true
          }
        })

        results.push({
          ...(discarded ? { discarded } : {}),
          runId: runId.toString(),
          status: 'triggered',
          workflowId: workflow.id.toString(),
          workflowName: workflow.name as string
        })

        logger.info({
          triggerSlug: slug,
          workflowId: workflow.id.toString(),
          workflowName: workflow.name
        }, 'Workflow executed successfully')

      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          triggerSlug: slug,
          workflowId: workflow.id.toString(),
          workflowName: workflow.name
        }, 'Failed to execute workflow')

        results.push({
          error: error instanceof Error ? error.message : 'Unknown error',
          runId: createdRunId?.toString() ?? 'failed',
          status: 'failed',
          workflowId: workflow.id.toString(),
          workflowName: workflow.name as string
        })
      }
    }

    return results

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      triggerSlug: slug
    }, 'Failed to trigger custom workflows')

    throw new Error(
      `Failed to trigger custom workflows: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}

/**
 * Trigger a single workflow by ID with custom trigger data.
 *
 * Throws, without creating a run, when the workflow does not exist, has no
 * trigger of type `triggerSlug`, or is disabled (`enabled: false`).
 *
 * Once the `workflow-runs` record exists the call resolves instead of
 * throwing: with `status: 'triggered'` when the run succeeded (or, in queue
 * mode, was queued), or with `status: 'failed'`, the step's `error` and the
 * failed run's `runId` when a step failed.
 */
export async function triggerWorkflowById(
  payload: Payload,
  workflowId: string,
  triggerSlug: string,
  data?: Record<string, unknown>,
  req?: PayloadRequest
): Promise<TriggerResult> {
  const logger = initializeLogger(payload)

  // Set once the run record exists, so a failed run still reports its id.
  let createdRunId: number | string | undefined
  let workflowName: string | undefined

  try {
    const workflow = await payload.findByID({
      id: workflowId,
      collection: 'workflows',
      depth: 2
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }
    workflowName = workflow.name as string

    // Verify the workflow has the specified custom trigger
    const triggers = workflow.triggers as Array<{ id?: number | string; type: string }>
    const firedTrigger = triggers?.find(trigger => trigger?.type === triggerSlug)

    if (!firedTrigger) {
      throw new Error(`Workflow ${workflowId} does not have trigger ${triggerSlug}`)
    }

    if (workflow.enabled === false) {
      throw new Error(`Workflow ${workflowId} is disabled`)
    }

    // Create a minimal request if not provided
    const workflowReq = req || {
      context: {},
      headers: new Headers(),
      payload
    } as PayloadRequest

    // Create execution context
    const context = {
      steps: {},
      trigger: {
        type: triggerSlug,
        data: data || {},
        triggeredAt: new Date().toISOString()
      }
    }

    // Create executor and execute
    const executor = new WorkflowExecutor(payload, logger)
    let discarded = false
    const runId = await executor.execute(workflow as PayloadWorkflow, context, workflowReq, firedTrigger, {
      onRunCreated: (id) => {
        createdRunId = id
      },
      onRunDiscarded: () => {
        discarded = true
      }
    })

    return {
      ...(discarded ? { discarded } : {}),
      runId: runId.toString(),
      status: 'triggered',
      workflowId: workflow.id.toString(),
      workflowName
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error({
      error: errorMessage,
      runId: createdRunId,
      triggerSlug,
      workflowId
    }, 'Failed to trigger workflow by ID')

    if (createdRunId === undefined) {
      throw error
    }

    return {
      error: errorMessage,
      runId: createdRunId.toString(),
      status: 'failed',
      workflowId: String(workflowId),
      workflowName: workflowName ?? ''
    }
  }
}
