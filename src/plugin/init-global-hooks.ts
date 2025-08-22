import type { Payload, PayloadRequest } from "payload"
import type { Logger } from "pino"

import type { WorkflowExecutor, Workflow } from "../core/workflow-executor.js"

export function initGlobalHooks(payload: Payload, logger: Payload['logger'], executor: WorkflowExecutor) {
  // Get all globals from the config
  const globals = payload.config.globals || []

  for (const globalConfig of globals) {
    const globalSlug = globalConfig.slug

    // Add afterChange hook to global
    if (!globalConfig.hooks) {
      globalConfig.hooks = {
        afterChange: [],
        afterRead: [],
        beforeChange: [],
        beforeRead: [],
        beforeValidate: []
      }
    }

    if (!globalConfig.hooks.afterChange) {
      globalConfig.hooks.afterChange = []
    }

    globalConfig.hooks.afterChange.push(async (change) => {
      logger.debug({
        global: globalSlug,
        operation: 'update'
      }, 'Global hook triggered')

      // Execute workflows for this global trigger
      await executeTriggeredGlobalWorkflows(
        globalSlug,
        'update',
        change.doc,
        change.previousDoc,
        change.req,
        payload,
        logger,
        executor
      )
    })

    logger.info({ globalSlug }, 'Global hooks registered')
  }
}

async function executeTriggeredGlobalWorkflows(
  globalSlug: string,
  operation: 'update',
  doc: Record<string, any>,
  previousDoc: Record<string, any>,
  req: PayloadRequest,
  payload: Payload,
  logger: Payload['logger'],
  executor: WorkflowExecutor
): Promise<void> {
  try {
    // Find workflows with matching global triggers
    const workflows = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100,
      req,
      where: {
        'triggers.global': {
          equals: globalSlug
        },
        'triggers.globalOperation': {
          equals: operation
        },
        'triggers.type': {
          equals: 'global-trigger'
        }
      }
    })

    for (const workflow of workflows.docs) {
      logger.info({
        globalSlug,
        operation,
        workflowId: workflow.id,
        workflowName: workflow.name
      }, 'Triggering global workflow')

      // Create execution context
      const context = {
        steps: {},
        trigger: {
          type: 'global',
          doc,
          global: globalSlug,
          operation,
          previousDoc,
          req
        }
      }

      // Execute the workflow
      await executor.execute(workflow as Workflow, context, req)
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      globalSlug,
      operation
    }, 'Failed to execute triggered global workflows')
  }
}
