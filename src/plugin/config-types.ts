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

/**
 * Plugin configuration for the workflows automation plugin.
 */
export type WorkflowsPluginConfig<
    TCollection extends string = string,
    TGlobal extends string = string
> = {
    /**
     * Whether the plugin is enabled. Defaults to true.
     */
    enabled?: boolean

    /**
     * Collection triggers configuration.
     * Keys are collection slugs, values configure which hooks to listen to.
     * Set to `true` to enable all default hooks (afterChange, afterDelete, afterRead).
     */
    collectionTriggers?: {
        [key in TCollection]?: {
        [key in keyof CollectionConfig['hooks']]?: true
    } | true
    }

    /**
     * Global triggers configuration.
     * Keys are global slugs, values configure which hooks to listen to.
     * Set to `true` to enable all default hooks (afterChange, afterRead).
     */
    globalTriggers?: {
        [key in TGlobal]?: {
        [key in keyof GlobalConfig['hooks']]?: true
    } | true
    }

    /**
     * Step task configurations.
     * These are the step types available for use in workflows.
     */
    steps: TaskConfig<string>[]
}