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
 * Slugs of the collections registered by the plugin.
 */
export type AutomationCollectionSlug =
    | 'workflows'
    | 'automation-triggers'
    | 'automation-steps'
    | 'workflow-runs'

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
     * Per-collection access overrides for the automation collections.
     *
     * By default every operation on the automation collections — reads
     * included — requires an authenticated user from the admin user
     * collection (`config.admin.user`). Workflow documents execute HTTP
     * requests and document writes with the host application's privileges,
     * and step configs and run records can hold credentials and response
     * bodies, so Payload's "any logged-in user" default is not safe here.
     *
     * Each key replaces the default access function for that operation on
     * that collection; operations left out keep the secure default. Plugin
     * internals (seeding, execution, usage counts) use the Local API and
     * are unaffected by these functions.
     */
    access?: Partial<Record<AutomationCollectionSlug, Partial<CollectionConfig['access']>>>

    /**
     * Logging configuration.
     * Set to true to enable debug logging.
     */
    debug?: boolean
}