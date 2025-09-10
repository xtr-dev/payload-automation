import {WorkflowExecutor} from "../core/workflow-executor.js"

export const createCollectionTriggerHook = (collectionSlug: string, hookType: string) => {
  return async (args: HookArgs) => {
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
