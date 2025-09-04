import type {Payload} from "payload"
import type {Logger} from "pino"

import type {WorkflowsPluginConfig} from "./config-types.js"

export function initStepTasks<T extends string>(pluginOptions: WorkflowsPluginConfig<T>, payload: Payload, logger: Payload['logger']) {
  logger.info({ stepCount: pluginOptions.steps.length, steps: pluginOptions.steps.map(s => s.slug) }, 'Step tasks were registered during config phase')

  // Verify that the tasks are available in the job system
  const availableTasks = payload.config.jobs?.tasks?.map(t => t.slug) || []
  const pluginTasks = pluginOptions.steps.map(s => s.slug)
  
  pluginTasks.forEach(taskSlug => {
    if (availableTasks.includes(taskSlug)) {
      logger.info({ taskSlug }, 'Step task confirmed available in job system')
    } else {
      logger.error({ taskSlug }, 'Step task not found in job system - this will cause execution failures')
    }
  })
}
