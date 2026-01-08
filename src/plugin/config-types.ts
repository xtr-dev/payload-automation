import type {CollectionConfig, GlobalConfig, TaskConfig} from "payload"

import type {Trigger} from "../triggers/types.js"

export type TriggerConfig = (config: WorkflowsPluginConfig) => Trigger

export type SeedWorkflow = {
  slug: string
  name: string
  description?: string
  triggers: Array<{
    type: string
    parameters?: Record<string, any>
    condition?: string
  }>
  steps: Array<{
    name: string
    type: string
    input?: Record<string, any>
    dependencies?: string[]
    condition?: string
  }>
}

export type WorkflowsPluginConfig<TSlug extends string = string, TGlobal extends string = string> = {
  collectionTriggers?: {
    [key in TSlug]?: {
      [key in keyof CollectionConfig['hooks']]?: true
    } | true
  }
  globalTriggers?: {
    [key in TGlobal]?: {
      [key in keyof GlobalConfig['hooks']]?: true
    } | true
  }
  enabled?: boolean
  seedWorkflows?: SeedWorkflow[]
  steps: TaskConfig<string>[]
  triggers?: TriggerConfig[]
}
