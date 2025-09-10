import {WorkflowExecutor} from '../core/workflow-executor.js'

export const createGlobalTriggerHook = (globalSlug: string, hookType: string) => {
  return async function payloadGlobalAutomationHook(args: any) {
    const req = 'req' in args ? args.req :
      'args' in args ? args.args.req :
      undefined
    if (!req) {
      throw new Error('No request object found in global hook arguments')
    }

    const payload = req.payload
    const logger = payload.logger

    try {
      logger.info({
        global: globalSlug,
        hookType,
        operation: hookType
      }, 'Global automation hook triggered')

      // Create executor on-demand
      const executor = new WorkflowExecutor(payload, logger)

      logger.debug('Executing triggered global workflows...')

      // Find workflows with matching global triggers
      const {docs: workflows} = await payload.find({
        collection: 'workflows',
        depth: 2,
        limit: 100,
        where: {
          'triggers.parameters.global': {
            equals: globalSlug
          },
          'triggers.parameters.operation': {
            equals: hookType
          },
          'triggers.type': {
            equals: 'global-hook'
          }
        }
      })

      // Execute each matching workflow
      for (const workflow of workflows) {
        // Create execution context
        const context = {
          steps: {},
          trigger: {
            ...args,
            type: 'global',
            global: globalSlug,
            operation: hookType,
            req
          }
        }

        try {
          await executor.execute(workflow, context, req)
          logger.info({
            workflowId: workflow.id,
            global: globalSlug,
            hookType
          }, 'Global workflow executed successfully')
        } catch (error) {
          logger.error({
            workflowId: workflow.id,
            global: globalSlug,
            hookType,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Global workflow execution failed')
          // Don't throw to prevent breaking the original operation
        }
      }

      logger.info({
        global: globalSlug,
        hookType
      }, 'Global workflow execution completed successfully')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error({
        global: globalSlug,
        hookType,
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'Global hook execution failed')

      // Don't throw to prevent breaking the original operation
    }
  }
}
