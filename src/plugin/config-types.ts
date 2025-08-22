import type {Field, TaskConfig} from "payload"

export type CollectionTriggerConfigCrud = {
  create?: true
  delete?: true
  read?: true
  update?: true
}

export type CollectionTriggerConfig = CollectionTriggerConfigCrud | true

export type CustomTriggerConfig = {
  inputs?: Field[]
  slug: string,
}

export type WorkflowsPluginConfig<TSlug extends string> = {
  collectionTriggers: {
    [key in TSlug]?: CollectionTriggerConfig
  }
  enabled?: boolean
  steps: TaskConfig<string>[],
  triggers?: CustomTriggerConfig[]
  webhookPrefix?: string
}
