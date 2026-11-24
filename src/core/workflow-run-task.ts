import type { TaskConfig } from 'payload'

import { initializeLogger } from '../plugin/logger.js'
import { WORKFLOW_RUN_TASK_SLUG, WorkflowExecutor } from './workflow-executor.js'

/**
 * Job task that runs the steps of a workflow run queued by
 * `WorkflowExecutor.execute` when `execution.mode` is `'queue'`. The plugin
 * registers it only in that mode.
 *
 * A failed workflow is recorded on the `workflow-runs` document and the task
 * still succeeds, so Payload's job retries never re-run steps that may already
 * have had side effects. Retries are left at 0 for the same reason.
 */
export const createWorkflowRunTask = (): TaskConfig<string> => ({
  slug: WORKFLOW_RUN_TASK_SLUG,
  label: 'Run automation workflow',
  inputSchema: [
    {
      name: 'workflowRunId',
      type: 'text',
      required: true,
    },
  ],
  outputSchema: [
    {
      name: 'error',
      type: 'text',
    },
  ],
  retries: 0,
  handler: async ({ input, req }) => {
    const { workflowRunId } = input as { workflowRunId: string }
    const logger = initializeLogger(req.payload)
    const executor = new WorkflowExecutor(req.payload, logger)
    try {
      await executor.executeQueuedRun(workflowRunId, req)
      return { output: {} }
    } catch (error) {
      // executeQueuedRun already stored the failure on the run record.
      return { output: { error: error instanceof Error ? error.message : 'Unknown error' } }
    }
  },
})
