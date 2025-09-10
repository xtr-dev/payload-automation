import type {CollectionConfig, TaskConfig} from "payload"

import type {Trigger} from "../triggers/types.js"

export type TriggerConfig = (config: WorkflowsPluginConfig) => Trigger

export type WorkflowsPluginConfig<TSlug extends string = string> = {
  collectionTriggers?: {
    [key in TSlug]?: {
      [key in keyof CollectionConfig['hooks']]?: true
    } | true
  }
  enabled?: boolean
  steps: TaskConfig<string>[]
  triggers?: TriggerConfig[]
  webhookPrefix?: string
}
