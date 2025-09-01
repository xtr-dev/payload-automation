import type {Config, PayloadRequest} from 'payload'

import {type PayloadWorkflow, WorkflowExecutor} from '../core/workflow-executor.js'
import {getConfigLogger, initializeLogger} from './logger.js'

export function initWebhookEndpoint(config: Config, webhookPrefix = 'webhook'): void {
  const logger = getConfigLogger()
  // Ensure the prefix starts with a slash
  const normalizedPrefix = webhookPrefix.startsWith('/') ? webhookPrefix : `/${webhookPrefix}`
  logger.debug(`Adding webhook endpoint to config with prefix: ${normalizedPrefix}`)
  logger.debug('Current config.endpoints length:', config.endpoints?.length || 0)

  // Define webhook endpoint
  const webhookEndpoint = {
    handler: async (req: PayloadRequest) => {
      const {path} = req.routeParams as { path: string }
      const webhookData = req.body || {}

      logger.debug('Webhook endpoint handler called, path: ' + path)

      try {
        // Find workflows with matching webhook triggers
        const workflows = await req.payload.find({
          collection: 'workflows',
          depth: 2,
          limit: 100,
          req,
          where: {
            'triggers.type': {
              equals: 'webhook-trigger'
            },
            'triggers.webhookPath': {
              equals: path
            }
          }
        })

        if (workflows.docs.length === 0) {
          return new Response(
            JSON.stringify({error: 'No workflows found for this webhook path'}),
            {
              headers: {'Content-Type': 'application/json'},
              status: 404
            }
          )
        }

        // Create a workflow executor for this request
        const logger = initializeLogger(req.payload)
        const executor = new WorkflowExecutor(req.payload, logger)

        const executionPromises = workflows.docs.map(async (workflow) => {
          try {
            // Create execution context for the webhook trigger
            const context = {
              steps: {},
              trigger: {
                type: 'webhook',
                data: webhookData,
                headers: Object.fromEntries(req.headers?.entries() || []),
                path,
                req
              }
            }

            // Find the matching trigger and check its condition if present
            const triggers = workflow.triggers as Array<{
              condition?: string
              type: string
              webhookPath?: string
            }>

            const matchingTrigger = triggers?.find(trigger =>
              trigger.type === 'webhook-trigger' &&
              trigger.webhookPath === path
            )

            // Check trigger condition if present
            if (matchingTrigger?.condition) {
              logger.debug({
                condition: matchingTrigger.condition,
                path,
                webhookData: JSON.stringify(webhookData).substring(0, 200),
                headers: Object.keys(context.trigger.headers || {}),
                workflowId: workflow.id,
                workflowName: workflow.name
              }, 'Evaluating webhook trigger condition')

              const conditionMet = executor.evaluateCondition(matchingTrigger.condition, context)

              if (!conditionMet) {
                logger.info({
                  condition: matchingTrigger.condition,
                  path,
                  webhookDataSnapshot: JSON.stringify(webhookData).substring(0, 200),
                  workflowId: workflow.id,
                  workflowName: workflow.name
                }, 'Webhook trigger condition not met, skipping workflow')

                return { reason: 'Condition not met', status: 'skipped', workflowId: workflow.id }
              }

              logger.info({
                condition: matchingTrigger.condition,
                path,
                webhookDataSnapshot: JSON.stringify(webhookData).substring(0, 200),
                workflowId: workflow.id,
                workflowName: workflow.name
              }, 'Webhook trigger condition met')
            }

            // Execute the workflow
            await executor.execute(workflow as PayloadWorkflow, context, req)

            return { status: 'triggered', workflowId: workflow.id }
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : 'Unknown error',
              status: 'failed',
              workflowId: workflow.id
            }
          }
        })

        const results = await Promise.allSettled(executionPromises)
        const resultsData = results.map((result, index) => {
          const baseResult = { workflowId: workflows.docs[index].id }
          if (result.status === 'fulfilled') {
            return { ...baseResult, ...result.value }
          } else {
            return { ...baseResult, error: result.reason, status: 'failed' }
          }
        })

        return new Response(
          JSON.stringify({
            message: `Triggered ${workflows.docs.length} workflow(s)`,
            results: resultsData
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          }
        )

      } catch (error) {
        return new Response(
          JSON.stringify({
            details: error instanceof Error ? error.message : 'Unknown error',
            error: 'Failed to process webhook'
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 500
          }
        )
      }
    },
    method: 'post' as const,
    path: `${normalizedPrefix}/:path`
  }

  // Check if the webhook endpoint already exists to avoid duplicates
  const existingEndpoint = config.endpoints?.find(endpoint =>
    endpoint.path === webhookEndpoint.path && endpoint.method === webhookEndpoint.method
  )

  if (!existingEndpoint) {
    // Combine existing endpoints with the webhook endpoint
    config.endpoints = [...(config.endpoints || []), webhookEndpoint]
    logger.debug(`Webhook endpoint added at path: ${webhookEndpoint.path}`)
    logger.debug('New config.endpoints length:', config.endpoints.length)
  } else {
    logger.debug(`Webhook endpoint already exists at path: ${webhookEndpoint.path}`)
  }
}
