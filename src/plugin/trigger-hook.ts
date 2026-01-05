import { WorkflowExecutor } from '../core/workflow-executor.js'

export type TriggerType = 'collection' | 'global'

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

  // Build context based on trigger type
  const buildContext = (args: any, firedTrigger?: any) => ({
    steps: {},
    trigger: {
      ...args,
      type,
      firedTrigger,
      ...(type === 'collection'
        ? { collection: slug }
        : { global: slug, operation: hookType }
      )
    }
  })

  return async function automationTriggerHook(args: any) {
    const req = 'req' in args ? args.req :
      'args' in args ? args.args.req :
      undefined

    if (!req) {
      throw new Error(`No request object found in ${type} hook arguments`)
    }

    const payload = req.payload
    const logger = payload.logger

    try {
      logger.info({
        triggerType: type,
        slug,
        hookType
      }, `${type} automation hook triggered`)

      const executor = new WorkflowExecutor(payload, logger)

      // Step 1: Find all triggers that match this hook event
      const triggerQuery = type === 'collection'
        ? {
            type: { equals: 'collection-hook' },
            collectionSlug: { equals: slug },
            hook: { equals: hookType }
          }
        : {
            type: { equals: 'global-hook' },
            globalSlug: { equals: slug },
            hook: { equals: hookType }
          }

      const { docs: matchingTriggers } = await payload.find({
        collection: 'automation-triggers',
        depth: 0,
        limit: 100,
        where: triggerQuery
      })

      if (matchingTriggers.length === 0) {
        logger.debug({
          triggerType: type,
          slug,
          hookType
        }, 'No matching triggers found')
        return
      }

      const triggerIds = matchingTriggers.map((t: { id: string | number }) => t.id)

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
        const firedTrigger = matchingTriggers.find((trigger: { id: string | number }) => {
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
          await executor.execute(workflow as any, context, req, firedTrigger)
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
