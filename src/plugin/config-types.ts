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
     * Where workflow steps run once a trigger fires.
     *
     * - `mode: 'inline'` (default): steps run inside the hook or call that
     *   fired the trigger, so e.g. a payment webhook's request waits for every
     *   step to finish.
     * - `mode: 'queue'`: the trigger only records a `pending` workflow run and
     *   queues one `automation-workflow-run` job on `queue` (Payload's
     *   `'default'` queue when omitted). The steps run when your job runner
     *   processes that queue (`jobs.autoRun`, `payload jobs:run`, or
     *   `payload.jobs.run()`), so nothing runs until one is set up. Queued
     *   steps see the stored `triggerData` snapshot instead of the live hook
     *   arguments, and run with the job runner's request rather than the
     *   triggering user's.
     */
    execution?: {
        mode?: 'inline' | 'queue'
        queue?: string
    }

    /**
     * Leave the triggering user out of what is stored on `workflow-runs`.
     * When `true`, every `user` object outside the document being acted on
     * (`req.user`, the trigger's own `user`, afterMe's `response.user`,
     * afterOperation's `result.user`) is dropped from `triggerData`, `context`
     * and `inputs`, and `triggeredBy` stores a `<collection>:<id>` reference
     * instead of the user's email. `user` fields inside `doc`, `previousDoc`,
     * `originalDoc` and `data` are document content and are kept.
     *
     * Independent of this option, secrets are never stored: auth fields
     * (`hash`, `salt`, `password`, `resetPasswordToken`,
     * `resetPasswordExpiration`, `_verificationToken`, `apiKey`, `apiKeyIndex`)
     * are dropped everywhere, including inside the document, and session
     * tokens (`token`, `refreshToken`) are dropped outside the document. The live
     * context that trigger conditions and inline steps evaluate is unchanged.
     *
     * Step inputs and outputs are cleaned before they reach the step's job,
     * the run (`stepResults`, `outputs`, `context`) or later steps: auth
     * secrets are always dropped, and with this option step input
     * expressions see `trigger.user`, `trigger.req.user`,
     * `trigger.response.user` and `trigger.result.user` as undefined, so the
     * acting user (or any of its fields) cannot be copied into a step.
     * Trigger and step conditions still see the full context.
     *
     * Stripping works on object keys, so a scalar picked out explicitly, such
     * as `{{trigger.previousDoc.hash}}` or `{{trigger.req.user.email}}`
     * without this option, is stored like any other value. The output a task
     * returns is also recorded by Payload's job runner in the job's
     * `payload-jobs` log before the plugin sees it; that copy is not cleaned
     * (with Payload's default `deleteJobOnComplete` the job row is deleted
     * once it succeeds).
     *
     * Defaults to `false`.
     */
    stripUserData?: boolean

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