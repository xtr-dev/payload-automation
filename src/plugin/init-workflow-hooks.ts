import type {Payload} from 'payload'

import {updateWorkflowCronJobs, removeWorkflowCronJobs} from './cron-scheduler.js'

/**
 * Initialize hooks for the workflows collection itself
 * to manage cron jobs when workflows are created/updated
 */
export function initWorkflowHooks(payload: Payload, logger: Payload['logger']): void {
  // Add afterChange hook to workflows collection to update cron jobs
  const workflowsCollection = payload.collections.workflows
  
  if (!workflowsCollection) {
    logger.warn('Workflows collection not found, cannot initialize workflow hooks')
    return
  }
  
  // Add afterChange hook to register/update cron jobs
  if (!workflowsCollection.config.hooks?.afterChange) {
    if (!workflowsCollection.config.hooks) {
      // @ts-expect-error - hooks object will be populated by Payload
      workflowsCollection.config.hooks = {}
    }
    workflowsCollection.config.hooks.afterChange = []
  }
  
  workflowsCollection.config.hooks.afterChange.push(async ({ doc, operation }) => {
    if (operation === 'create' || operation === 'update') {
      logger.debug({
        operation,
        workflowId: doc.id,
        workflowName: doc.name
      }, 'Workflow changed, updating cron jobs selectively')
      
      // Update cron jobs for this specific workflow only
      await updateWorkflowCronJobs(doc.id, payload, logger)
    }
  })
  
  // Add afterDelete hook to clean up cron jobs
  if (!workflowsCollection.config.hooks?.afterDelete) {
    workflowsCollection.config.hooks.afterDelete = []
  }
  
  workflowsCollection.config.hooks.afterDelete.push(async ({ doc }) => {
    logger.debug({
      workflowId: doc.id,
      workflowName: doc.name
    }, 'Workflow deleted, removing cron jobs')
    
    // Remove cron jobs for the deleted workflow
    removeWorkflowCronJobs(doc.id, payload, logger)
  })
  
  logger.info('Workflow hooks initialized for cron job management')
}