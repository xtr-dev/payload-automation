import type {TaskConfig} from "payload"

import type {Trigger} from "../triggers/types.js"

export type CollectionTriggerConfigCrud = {
  create?: true
  delete?: true
  read?: true
  update?: true
}

export type CollectionTriggerConfig = CollectionTriggerConfigCrud | true

export type TriggerConfig = <T extends string>(config: WorkflowsPluginConfig<T>) => Trigger

export type WorkflowsPluginConfig<TSlug extends string> = {
  collectionTriggers: {
    [key in TSlug]?: CollectionTriggerConfig
  }
  enabled?: boolean
  steps: TaskConfig<string>[],
  triggers?: TriggerConfig[]
  webhookPrefix?: string
}
