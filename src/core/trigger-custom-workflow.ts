import type { Payload, PayloadRequest } from 'payload'

import { initializeLogger } from '../plugin/logger.js'
import { type Workflow, WorkflowExecutor } from './workflow-executor.js'

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
   * The slug of the custom trigger to execute
   */
  slug: string

  /**
   * Optional user information for tracking who triggered the workflow
   */
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

/**
 * Programmatically trigger workflows that have a matching custom trigger
 *
 * @example
 * ```typescript
 * // In your onInit or elsewhere in your code
 * await triggerCustomWorkflow(payload, {
 *   slug: 'data-import',
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
  const { slug, data = {}, req, user } = options

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
            req: workflowReq,
            triggeredAt: new Date().toISOString(),
            user: (user || workflowReq.user) ? {
              id: (user || workflowReq.user)?.id?.toString(),
              email: (user || workflowReq.user)?.email
            } : undefined
          }
        }

        // Execute the workflow
        await executor.execute(workflow as Workflow, context, workflowReq)

        // Get the latest run for this workflow to get the run ID
        const runs = await payload.find({
          collection: 'workflow-runs',
          limit: 1,
          sort: '-createdAt',
          where: {
            workflow: {
              equals: workflow.id
            }
          }
        })

        results.push({
          runId: runs.docs[0]?.id?.toString() || 'unknown',
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
          runId: 'failed',
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
 * Helper function to trigger a single workflow by ID with custom trigger data
 * This is useful when you know exactly which workflow you want to trigger
 */
export async function triggerWorkflowById(
  payload: Payload,
  workflowId: string,
  triggerSlug: string,
  data?: Record<string, unknown>,
  req?: PayloadRequest
): Promise<TriggerResult> {
  const logger = initializeLogger(payload)

  try {
    const workflow = await payload.findByID({
      id: workflowId,
      collection: 'workflows',
      depth: 2
    })

    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Verify the workflow has the specified custom trigger
    const triggers = workflow.triggers as Array<{type: string}>
    const hasMatchingTrigger = triggers?.some(trigger => trigger.type === triggerSlug)

    if (!hasMatchingTrigger) {
      throw new Error(`Workflow ${workflowId} does not have trigger ${triggerSlug}`)
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
        req: workflowReq,
        triggeredAt: new Date().toISOString()
      }
    }

    // Create executor and execute
    const executor = new WorkflowExecutor(payload, logger)
    await executor.execute(workflow as Workflow, context, workflowReq)

    // Get the latest run to get the run ID
    const runs = await payload.find({
      collection: 'workflow-runs',
      limit: 1,
      sort: '-createdAt',
      where: {
        workflow: {
          equals: workflow.id
        }
      }
    })

    return {
      runId: runs.docs[0]?.id?.toString() || 'unknown',
      status: 'triggered',
      workflowId: workflow.id.toString(),
      workflowName: workflow.name as string
    }

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      triggerSlug,
      workflowId
    }, 'Failed to trigger workflow by ID')

    throw error
  }
}
