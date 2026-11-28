import type {CollectionConfig, GlobalConfig, TaskConfig} from "payload"

/**
 * A workflow defined in code and created (or brought back in line) on startup.
 *
 * `slug`, `name`, `description`, `triggers` and `steps` are always written.
 * The optional settings (`errorHandling`, `maxRetries`, `retryDelay`,
 * `timeout`, `discardRunWhen`, and a step's `retryOnFailure`, `maxRetries`,
 * `retryDelay`) are
 * only managed when the definition declares them: a declared setting is
 * written on create and restored on startup when the stored value differs,
 * an omitted one gets the collection's default on create and is left as
 * stored afterwards.
 */
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
    slug?: string  // Optional: the slugified name if not provided. Must be unique within the workflow.
    type: string
    input?: Record<string, any>
    dependencies?: string[]  // Array of step slugs
    condition?: string
    /**
     * Retry this step when it fails, with the step's own `maxRetries` and
     * `retryDelay` instead of the workflow's. Stored on the step's
     * `automation-steps` document.
     */
    retryOnFailure?: boolean
    /**
     * Retries after the first failed attempt (3 means up to 4 attempts).
     * Only used with `retryOnFailure: true`. Collection default: 3.
     */
    maxRetries?: number
    /**
     * Milliseconds to wait before each retry. Only used with
     * `retryOnFailure: true`. Collection default: 1000.
     */
    retryDelay?: number
  }>
  /**
   * What happens when a step fails after its last attempt: `'stop'` fails
   * the run, `'continue'` runs the remaining steps that do not depend on the
   * failed one, `'retry'` retries every step with the workflow's `maxRetries`
   * and `retryDelay` and then stops. Collection default: `'stop'`.
   */
  errorHandling?: 'continue' | 'retry' | 'stop'
  /**
   * Retries per failed step when `errorHandling` is `'retry'` (3 means up to
   * 4 attempts). Collection default: 3.
   */
  maxRetries?: number
  /**
   * Milliseconds to wait before each retry when `errorHandling` is
   * `'retry'`. Collection default: 1000.
   */
  retryDelay?: number
  /**
   * Maximum duration of a whole run in milliseconds, retries and their
   * delays included; `0` for no limit. Collection default: 300000.
   */
  timeout?: number
  /**
   * JSONata expression (bare, no `{{ }}`) evaluated when a run finishes
   * without a failed step. When true, the run is deleted instead of kept in
   * `workflow-runs`. For workflows that often have nothing to do, e.g.
   * `'steps.release.output.released = 0'` on a scheduled cleanup. Failed
   * runs are always kept. Collection default: empty (keep every run).
   */
  discardRunWhen?: string
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
     *
     * Overrides decide who may perform an operation; they do not switch off
     * the read-only locks. Update and delete on `workflows` still refuse
     * stored `readOnly: true` workflows, and update and delete on
     * `automation-triggers` and `automation-steps` still refuse documents a
     * read-only workflow references: the lock is ANDed with the override
     * (a `Where` it returns is combined with the override's result).
     */
    access?: Partial<Record<AutomationCollectionSlug, Partial<CollectionConfig['access']>>>

    /**
     * Where workflow steps run once a trigger fires.
     *
     * - `mode: 'inline'` (default): steps run inside the hook or call that
     *   fired the trigger, so e.g. a payment webhook's request waits for every
     *   step to finish. A hook that runs inside a database transaction
     *   (always on Postgres, on MongoDB with a replica set) starts the
     *   workflow when that transaction has committed, and not at all when it
     *   is rolled back; the triggering operation still waits for the steps.
     * - `mode: 'queue'`: the trigger only records a `pending` workflow run and
     *   queues one `automation-workflow-run` job on `queue` (Payload's
     *   `'default'` queue when omitted). The steps run when your job runner
     *   processes that queue (`jobs.autoRun`, `payload jobs:run`, or
     *   `payload.jobs.run()`), so nothing runs until one is set up. Queued
     *   steps see the stored `triggerData` snapshot instead of the live hook
     *   arguments, and run with the job runner's request rather than the
     *   triggering user's.
     * - `maxInProcessRetryDelay` (milliseconds, default 5000): the longest
     *   wait between two attempts of a retried step that a queued run sleeps
     *   through inside its job. For a longer `retryDelay` the run is saved as
     *   `pending` and a new `automation-workflow-run` job is queued with
     *   `waitUntil` set to the retry time, so no job-runner slot is held
     *   while waiting. Only applies with `mode: 'queue'`: an inline run has
     *   no job runner to resume it and always waits in the triggering call.
     */
    execution?: {
        maxInProcessRetryDelay?: number
        mode?: 'inline' | 'queue'
        queue?: string
    }

    /**
     * Firing of `scheduled` (cron) triggers.
     *
     * The plugin registers the `automation-scheduled-triggers` job task with a
     * Payload `schedule`, so Payload's scheduler queues it every `tick` on
     * `queue`. Each run fires the scheduled triggers that came due since they
     * last fired (at most once each, however many occurrences were missed).
     * Nothing fires unless the host runs Payload's job queue with scheduling:
     * `jobs.autoRun` on a long-running server (in Next.js, Payload must also
     * be loaded with `getPayload({ config, cron: true })` for the autoRun
     * crons to start), or a cron calling `GET /api/payload-jobs/run` (see the
     * README).
     *
     * - `tick`: how often to look for due triggers, as a cron expression
     *   (an optional leading seconds field is supported). A trigger can fire
     *   no more precisely than this. Default: `'* * * * *'` (every minute).
     * - `queue`: the jobs queue the task is scheduled on. Default: `'default'`.
     *
     * Set to `false` to register no task; scheduled triggers then only fire
     * when `runScheduledTriggers(payload)` is called.
     */
    scheduledTriggers?: false | {
        queue?: string
        tick?: string
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
     * Fields of the triggering document that must not end up in
     * `workflow-runs` or `payload-jobs`.
     *
     * A hook receives the document as the Local API reads it, with every
     * field, including ones the collection hides from its own readers (for
     * example a token with `access: { read: () => false }`). Without this
     * option the whole document is stored in the run's `triggerData`, where
     * everyone who may read runs can see it.
     *
     * - `collections` / `globals`: per slug, the paths of the fields to leave
     *   out, in dot notation (`'accessToken'`, `'payment.token'`). A path
     *   through an array or blocks field applies to every row
     *   (`'items.secret'`); a path to a group, array or tab removes it whole.
     * - `hiddenFields: true`: also leave out every field that the collection
     *   or global config itself restricts: `hidden: true`, or any
     *   `access.read` function. The function is not called, because a run is
     *   read by other people than the one who triggered it: a field with
     *   read access control is left out for everybody.
     * - `hideFromExpressions: true`: also remove the fields from the live
     *   context, so no trigger condition, step condition or step input can
     *   read them. Use it for fields no workflow should ever handle.
     *
     * What is cleaned, for a collection or global hook trigger:
     * - the documents in the trigger (`doc`, `previousDoc`, `originalDoc`,
     *   `data`, `args.data`, and an afterOperation `result`, `result.doc` and
     *   `result.docs`) as stored in the run's `triggerData`, `inputs` and
     *   `context`;
     * - a step input that copies such a document, or a part of it, as a
     *   whole (`{{trigger.doc}}`, `{{trigger}}`): the copy the step's job
     *   receives, and with it `stepResults`, `payload-jobs` and the debug log
     *   of queued jobs, has the fields removed;
     * - the output of a step whose input has a `collectionSlug` and whose
     *   output has `doc` or `docs`, which is the shape of the built-in
     *   read, create, update and delete document steps: the fields listed
     *   for that collection are removed before the output is stored or
     *   passed on to later steps.
     *
     * What still works without `hideFromExpressions`: with
     * `execution.mode: 'inline'`, conditions and step inputs are evaluated
     * against the live hook arguments, so a step can be given a redacted
     * field by naming it: `{{trigger.doc.accessToken}}`. That value is then
     * part of the step's input and stored like any other input. With
     * `execution.mode: 'queue'`, and when a run is retried with
     * `retryWorkflowRun`, steps read the stored `triggerData`, so a redacted
     * field is not available to them at all.
     *
     * Not covered: the `data` of manual, webhook and scheduled triggers
     * (they have no collection), documents nested through a relationship
     * populated at `depth` > 0, and the output of custom steps that do not
     * follow the shape above.
     *
     * Defaults to no redaction.
     */
    redactFields?: {
        collections?: { [key in TCollection]?: string[] }
        globals?: { [key in TGlobal]?: string[] }
        hiddenFields?: boolean
        hideFromExpressions?: boolean
    }

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