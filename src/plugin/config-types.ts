import type {CollectionConfig, GlobalConfig, TaskConfig} from "payload"

/**
 * Trigger definition for custom trigger configurations.
 */
export interface Trigger {
    slug: string
    label?: string
    parameters?: Array<{
        name: string
        type: string
        required?: boolean
    }>
}

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
    slug?: string  // Optional: auto-generated from name if not provided
    type: string
    input?: Record<string, any>
    dependencies?: string[]  // Array of step slugs
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
     *
     * A registered hook only does work when an `automation-triggers` document
     * listens to it: the trigger list is cached (see `triggerCacheTTL`), so an
     * unused hook such as afterRead costs an in-memory lookup per call, not a
     * database query. List hooks explicitly (e.g. `{ afterChange: true }`) to
     * skip registering the others altogether.
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
     * Optional: without it the plugin still registers its collections and
     * trigger hooks, but no step types exist until some are passed in.
     * The built-in tasks (HttpRequestStepTask etc.) are exported from
     * '@xtr-dev/payload-automation/server' and must be passed explicitly.
     */
    steps?: TaskConfig<string>[]

    /**
     * Seed workflows to create on plugin initialization.
     * These workflows are read-only and serve as templates.
     */
    seedWorkflows?: SeedWorkflow[]

    /**
     * Custom trigger configurations.
     */
    triggers?: TriggerConfig[]

    /**
     * How long, in milliseconds, the collection/global hook handlers reuse the
     * list of collection-hook and global-hook triggers before reloading it.
     * Creating, updating or deleting a trigger through this Payload instance
     * clears the cache immediately; the TTL only bounds how long changes made
     * by another process (another server instance, a direct database write)
     * take to be picked up. Set to `0` to query on every hook call.
     *
     * Defaults to 60000 (one minute).
     */
    triggerCacheTTL?: number

    /**
     * Logging configuration.
     * Set to true to enable debug logging.
     */
    debug?: boolean
}