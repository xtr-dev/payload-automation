import type { Endpoint, PayloadRequest } from 'payload'

import type { ExecutionContext, PayloadWorkflow } from '../core/workflow-executor.js'

import { WorkflowExecutor } from '../core/workflow-executor.js'
import { normalizeWebhookPath, webhookSecretMatches } from '../utils/webhook.js'

/**
 * Path pattern for the webhook endpoint. Payload mounts custom endpoints under
 * its API route, so a trigger with webhookPath "my-webhook" is served at
 * POST /api/automation/webhooks/my-webhook.
 */
export const WEBHOOK_ENDPOINT_PATH = '/automation/webhooks/:webhookPath'

interface WebhookTriggerDoc {
  id: number | string
  condition?: null | string
  name?: string
  webhookPath?: null | string
  webhookSecret?: null | string
  webhookSecretHash?: null | string
}

interface WebhookWorkflowResult {
  error?: string
  status: 'failed' | 'skipped' | 'triggered'
  workflowId: string
  workflowName: string
}

/**
 * Serves webhook triggers: matches the request path against
 * automation-triggers documents of type "webhook", authenticates against the
 * trigger's secret, and executes every enabled workflow referencing a matched
 * trigger. Registered at config time by the plugin, so it exists exactly when
 * the plugin is enabled.
 */
export const webhookEndpoint: Endpoint = {
  handler: async (req: PayloadRequest) => {
    const payload = req.payload
    const logger = payload.logger

    try {
      const rawParam = req.routeParams?.webhookPath
      const requestedPath = typeof rawParam === 'string' ? normalizeWebhookPath(rawParam) : ''

      if (!requestedPath) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      // The Triggers collection stores paths normalized, so an exact match
      // finds them. The slash-wrapped spellings also match documents saved
      // before that normalization existed. Filtering in the query rather
      // than over a fetched page means every trigger is reachable, however
      // many webhook triggers exist.
      const { docs } = await payload.find({
        collection: 'automation-triggers',
        depth: 0,
        pagination: false,
        // webhookSecretHash is a hidden field, left out of reads otherwise.
        showHiddenFields: true,
        where: {
          and: [
            { type: { equals: 'webhook' } },
            {
              webhookPath: {
                in: [requestedPath, `/${requestedPath}`, `${requestedPath}/`, `/${requestedPath}/`],
              },
            },
          ],
        },
      })

      const matchingTriggers = docs as WebhookTriggerDoc[]

      if (matchingTriggers.length === 0) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      // The secret may arrive as a dedicated header or as a bearer token —
      // some webhook producers only allow configuring an Authorization header.
      const authHeader = req.headers.get('authorization') ?? ''
      const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
      const providedSecret = req.headers.get('x-webhook-secret') ?? bearerSecret

      // A trigger without a stored secret is not fireable rather than open:
      // documents created before the secret field existed must fail closed.
      const authenticatedTriggers = providedSecret
        ? matchingTriggers.filter(
            (trigger) =>
              typeof trigger.webhookSecretHash === 'string' &&
              trigger.webhookSecretHash.length > 0 &&
              webhookSecretMatches(providedSecret, trigger.webhookSecretHash)
          )
        : []

      if (authenticatedTriggers.length === 0) {
        logger.warn({ webhookPath: requestedPath }, 'Webhook request rejected: missing or invalid secret')
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // A non-JSON or empty body is a valid webhook call; the payload is just absent.
      let body: unknown = null
      try {
        body = await req.json?.()
      } catch {
        body = null
      }

      const query = Object.fromEntries(new URL(req.url ?? '', 'http://localhost').searchParams)

      const triggerIds = authenticatedTriggers.map((trigger) => trigger.id)

      const { docs: workflows } = await payload.find({
        collection: 'workflows',
        depth: 2,
        pagination: false,
        where: {
          enabled: { equals: true },
          triggers: { in: triggerIds },
        },
      })

      const executor = new WorkflowExecutor(payload, logger)
      const results: WebhookWorkflowResult[] = []

      for (const workflow of workflows) {
        const workflowTriggerIds = ((workflow.triggers as unknown[]) || []).map((t) =>
          typeof t === 'object' && t !== null ? (t as { id: number | string }).id : (t as number | string)
        )
        const firedTrigger = authenticatedTriggers.find((trigger) =>
          workflowTriggerIds.includes(trigger.id)
        )

        if (!firedTrigger) {
          continue
        }

        // The secret hash's only job is authenticating the caller, which
        // happened above. Anything in the context is stored verbatim on the
        // workflow-runs record and readable by every JSONata expression as
        // trigger.firedTrigger.*, so the hash must not travel past this point.
        const {
          webhookSecret: _webhookSecret,
          webhookSecretHash: _webhookSecretHash,
          ...safeTrigger
        } = firedTrigger

        // The live req is deliberately NOT part of this context: JSONata
        // evaluates against it raw, and req.payload would hand expressions the
        // whole Payload instance. Headers are excluded for the same reason —
        // they carry the webhook secret.
        const context: ExecutionContext = {
          steps: {},
          trigger: {
            type: 'webhook',
            body,
            // A distinct copy, not a second reference: the executor's
            // safeSerialize treats any object it has already seen as
            // "[Circular Reference]", so sharing one object between body and
            // doc would store the run's doc as that placeholder string.
            doc: structuredClone(body),
            firedTrigger: safeTrigger,
            query,
            triggeredAt: new Date().toISOString(),
            webhookPath: requestedPath,
          },
        }

        if (firedTrigger.condition) {
          try {
            const conditionMet = await executor.evaluateCondition(firedTrigger.condition, context)
            if (!conditionMet) {
              results.push({
                status: 'skipped',
                workflowId: String(workflow.id),
                workflowName: String(workflow.name),
              })
              continue
            }
          } catch (error) {
            logger.error(
              {
                error: error instanceof Error ? error.message : 'Unknown error',
                triggerId: firedTrigger.id,
                workflowId: workflow.id,
              },
              'Failed to evaluate webhook trigger condition'
            )
            results.push({
              error: 'Failed to evaluate trigger condition',
              status: 'failed',
              workflowId: String(workflow.id),
              workflowName: String(workflow.name),
            })
            continue
          }
        }

        try {
          await executor.execute(workflow as unknown as PayloadWorkflow, context, req, safeTrigger)
          results.push({
            status: 'triggered',
            workflowId: String(workflow.id),
            workflowName: String(workflow.name),
          })
        } catch (error) {
          logger.error(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              triggerId: firedTrigger.id,
              workflowId: workflow.id,
            },
            'Webhook workflow execution failed'
          )
          results.push({
            error: error instanceof Error ? error.message : 'Unknown error',
            status: 'failed',
            workflowId: String(workflow.id),
            workflowName: String(workflow.name),
          })
        }
      }

      logger.info(
        { webhookPath: requestedPath, workflowCount: results.length },
        'Webhook processed'
      )

      return Response.json({ webhookPath: requestedPath, workflows: results }, { status: 200 })
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Webhook endpoint failed'
      )
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  },
  method: 'post',
  path: WEBHOOK_ENDPOINT_PATH,
}
