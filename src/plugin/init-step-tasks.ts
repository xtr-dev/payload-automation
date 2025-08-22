import type {Payload} from "payload"
import type {Logger} from "pino"

import type {WorkflowsPluginConfig} from "./config-types.js"

export function initStepTasks<T extends string>(pluginOptions: WorkflowsPluginConfig<T>, payload: Payload, logger: Payload['logger']) {
  logger.info({ stepCount: pluginOptions.steps.length, steps: pluginOptions.steps.map(s => s.slug) }, 'Initializing step tasks')

}
