import { WorkflowExecutor } from '../core/workflow-executor.js'
import { getPluginConfig } from './get-plugin-config.js'
import {
  DEFAULT_TRIGGER_CACHE_TTL_MS,
  getHookTriggers,
  selectMatchingTriggers
} from './trigger-cache.js'

export type TriggerType = 'collection' | 'global'

/**
 * The parts of a PayloadRequest that trigger expressions may read as
 * `trigger.req`: the acting user and the request locale. Everything else on
 * the request (payload, transactionID, headers, the raw request) stays out of
 * the expression context.
 */
const toExpressionReq = (req: any) =>
  req && typeof req === 'object'
    ? { fallbackLocale: req.fallbackLocale, locale: req.locale, user: req.user }
    : req

/**
 * Copies hook arguments for the expression context, replacing each request
 * object with its plain projection from toExpressionReq.
 */
const toExpressionArgs = (args: any) => {
  const copy = { ...args }
  if ('req' in copy) {
    copy.req = toExpressionReq(copy.req)
  }
  if (copy.args && typeof copy.args === 'object' && 'req' in copy.args) {
    copy.args = { ...copy.args, req: toExpressionReq(copy.args.req) }
  }
  return copy
}

export interface TriggerConfig {
  type: TriggerType
  slug: string
  hookType: string
}

/**
 * Creates a unified hook handler for both collection and global triggers.
 * Works with the new relationship-based data model where triggers are a separate collection.
 */
export const createTriggerHook = (config: TriggerConfig) => {
  const { type, slug, hookType } = config

  // Build context based on trigger type. JSONata conditions and step inputs
  // are evaluated against this object as-is, so it must not hold the live
  // PayloadRequest: through `trigger.req.payload` an expression could reach
  // the whole Payload instance. Hook args carry req at the top level and, for
  // operation hooks (beforeOperation, me, refresh), also under `args.req`.
  const buildContext = (args: any, firedTrigger?: any) => ({
    steps: {},
    trigger: {
      ...toExpressionArgs(args),
      type,
      firedTrigger,
      ...(type === 'collection'
        ? { collection: slug }
        : { global: slug, operation: hookType }
      )
    }
  })

  return async function automationTriggerHook(args: any) {
    // Standard doc-lifecycle hooks (afterChange, beforeDelete, ...) receive req directly.
    // The auth override hooks `me` and `refresh` use a different contract — Payload calls
    // them as ({ args, user }), where `args` is the operation's own argument object and req
    // lives underneath it — hence the fallback. Neither this hook nor anything it calls ever
    // returns a value, so it can't accidentally short-circuit Payload's default me/refresh
    // operation logic (both hooks treat a defined return as "skip the built-in behavior").
    const req = 'req' in args ? args.req :
      'args' in args ? args.args.req :
      undefined

    if (!req) {
      throw new Error(`No request object found in ${type} hook arguments`)
    }

    const payload = req.payload
    const logger = payload.logger

    try {
      logger.debug({
        triggerType: type,
        slug,
        hookType
      }, `${type} automation hook triggered`)

      // Step 1: Find all triggers that match this hook event. The trigger list
      // is cached per Payload instance, so a hook nobody listens to (afterRead
      // on a busy collection, for example) costs an in-memory filter instead
      // of a database query on every call.
      const pluginConfig = getPluginConfig(payload)
      const ttlMs = pluginConfig.triggerCacheTTL ?? DEFAULT_TRIGGER_CACHE_TTL_MS
      const matchingTriggers = selectMatchingTriggers(
        await getHookTriggers(payload, ttlMs),
        type,
        slug,
        hookType
      )

      if (matchingTriggers.length === 0) {
        logger.debug({
          triggerType: type,
          slug,
          hookType
        }, 'No matching triggers found')
        return
      }

      const executor = new WorkflowExecutor(payload, logger)

      const triggerIds = matchingTriggers.map((t) => t.id)

      // Step 2: Find all enabled workflows that reference any of these triggers
      const { docs: workflows } = await payload.find({
        collection: 'workflows',
        depth: 2, // Load trigger and step details
        limit: 100,
        where: {
          enabled: { equals: true },
          triggers: { in: triggerIds }
        }
      })

      if (workflows.length === 0) {
        logger.debug({
          triggerType: type,
          slug,
          hookType,
          triggerIds
        }, 'No enabled workflows found for matching triggers')
        return
      }

      // Step 3: Execute each matching workflow
      for (const workflow of workflows) {
        // Find which trigger actually fired (for tracking in WorkflowRuns)
        const firedTrigger = matchingTriggers.find((trigger) => {
          const workflowTriggerIds = (workflow.triggers || []).map((t: any) =>
            typeof t === 'object' ? t.id : t
          )
          return workflowTriggerIds.includes(trigger.id)
        })

        if (!firedTrigger) {
          continue
        }

        const context = buildContext(args, firedTrigger)

        // Evaluate trigger condition if present
        if (firedTrigger.condition) {
          try {
            const conditionMet = await executor.evaluateCondition(firedTrigger.condition, context)
            if (!conditionMet) {
              logger.debug({
                workflowId: workflow.id,
                triggerId: firedTrigger.id,
                condition: firedTrigger.condition
              }, 'Workflow skipped due to unmet trigger condition')
              continue
            }
          } catch (error) {
            logger.error({
              workflowId: workflow.id,
              triggerId: firedTrigger.id,
              condition: firedTrigger.condition,
              error: error instanceof Error ? error.message : 'Unknown error'
            }, 'Failed to evaluate trigger condition')
            continue
          }
        }

        try {
          await executor.execute(workflow, context, req, firedTrigger)
          logger.info({
            workflowId: workflow.id,
            workflowName: workflow.name,
            triggerId: firedTrigger.id,
            triggerName: firedTrigger.name,
            triggerType: type,
            slug,
            hookType
          }, 'Workflow executed successfully')
        } catch (error) {
          logger.error({
            workflowId: workflow.id,
            workflowName: workflow.name,
            triggerId: firedTrigger.id,
            triggerName: firedTrigger.name,
            triggerType: type,
            slug,
            hookType,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Workflow execution failed')
          // Don't throw to prevent breaking the original operation
        }
      }

      logger.info({
        triggerType: type,
        slug,
        hookType,
        workflowCount: workflows.length
      }, `${type} workflow execution completed`)

    } catch (error) {
      logger.error({
        triggerType: type,
        slug,
        hookType,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      }, `${type} hook execution failed`)
      // Don't throw to prevent breaking the original operation
    }
  }
}

// Convenience functions for creating hooks
export const createCollectionTriggerHook = (collectionSlug: string, hookType: string) =>
  createTriggerHook({ type: 'collection', slug: collectionSlug, hookType })

export const createGlobalTriggerHook = (globalSlug: string, hookType: string) =>
  createTriggerHook({ type: 'global', slug: globalSlug, hookType })
