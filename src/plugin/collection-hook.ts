import {WorkflowExecutor} from "../core/workflow-executor.js"

export const createCollectionTriggerHook = (collectionSlug: string, hookType: string) => {
  return async (args: any) => {
    const req = 'req' in args ? args.req :
      'args' in args ? args.args.req :
        undefined
    if (!req) {
      throw new Error('No request object found in hook arguments')
    }
    const payload = req.payload
    const {docs: workflows} = await payload.find({
      collection: 'workflows',
      depth: 2,
      limit: 100,
      where: {
        'triggers.parameters.collectionSlug': {
          equals: collectionSlug
        },
        'triggers.parameters.hook': {
          equals: hookType
        },
        'triggers.type': {
          equals: 'collection-hook'
        }
      }
    })
    const executor = new WorkflowExecutor(payload, payload.logger)
    // invoke each workflow
    for (const workflow of workflows) {
      // Create execution context
      const context = {
        steps: {},
        trigger: {
          ...args,
          type: 'collection',
          collection: collectionSlug,
        }
      }

      // Check if any trigger has a condition and evaluate it
      let shouldExecute = false
      for (const trigger of workflow.triggers || []) {
        if (trigger.type === 'collection-hook' && 
            trigger.parameters?.collectionSlug === collectionSlug && 
            trigger.parameters?.hook === hookType) {
          
          if (trigger.condition) {
            // Evaluate the condition
            try {
              const conditionMet = executor.evaluateCondition(trigger.condition, context)
              if (conditionMet) {
                shouldExecute = true
                break
              }
            } catch (error) {
              payload.logger.error({
                workflowId: workflow.id,
                condition: trigger.condition,
                error: error instanceof Error ? error.message : 'Unknown error'
              }, 'Failed to evaluate trigger condition')
            }
          } else {
            // No condition means always execute
            shouldExecute = true
            break
          }
        }
      }

      if (!shouldExecute) {
        payload.logger.debug({
          workflowId: workflow.id,
          collection: collectionSlug,
          hookType
        }, 'Workflow skipped due to unmet condition')
        continue
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await executor.execute(workflow as any, context, req)
        payload.logger.info({
          workflowId: workflow.id,
          collection: collectionSlug,
          hookType
        }, 'Workflow executed successfully')
      } catch (error) {
        payload.logger.error({
          workflowId: workflow.id,
          collection: collectionSlug,
          hookType,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Workflow execution failed')
        // Don't throw to prevent breaking the original operation
      }
    }
  }
}
