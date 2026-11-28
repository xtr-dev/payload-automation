# @xtr-dev/payload-automation

[![npm version](https://badge.fury.io/js/@xtr-dev%2Fpayload-automation.svg)](https://www.npmjs.com/package/@xtr-dev/payload-automation)

A workflow automation plugin for PayloadCMS 3.x. Workflows are configured in the admin panel and run when documents change, on a cron schedule, from a webhook, or from your own code.

> **v0.x** — minor versions may contain breaking changes until 1.0.

## Features

- Run workflows from collection and global hooks, cron schedules, authenticated webhooks, or code
- Built-in steps for HTTP requests, document CRUD and email; any Payload task can be a step
- JSONata expressions for step inputs and conditions, including output from earlier steps
- Step dependencies: independent steps run in parallel, dependent ones in order
- Inline or queued (Payload job queue) execution
- Step retries with a delay, per step or as a workflow default, and a run timeout
- Run history in `workflow-runs`, with retry from a stored run and an optional rule that leaves idle runs out
- Read-only template workflows seeded from code

## Requirements

- PayloadCMS ^3.79.1
- Node.js ^18.20.2 || >=20.9.0
- React ^19.0.0 (for client components; declared as a peer dependency)
- Any Payload database adapter: MongoDB, Postgres or SQLite. Postgres needs no extension (versions up to 0.6.1 required PostGIS, see [Upgrading](#upgrading))

## Installation

```bash
pnpm add @xtr-dev/payload-automation
```

## Quick Start

```typescript
import { buildConfig } from 'payload'
import {
  workflowsPlugin,
  HttpRequestStepTask,
  CreateDocumentStepTask,
  ReadDocumentStepTask,
  UpdateDocumentStepTask,
  DeleteDocumentStepTask,
  SendEmailStepTask,
} from '@xtr-dev/payload-automation/server'

export default buildConfig({
  // ... your config
  plugins: [
    workflowsPlugin({
      collectionTriggers: {
        posts: true,                 // afterChange, afterDelete and afterRead
        users: { afterChange: true }, // only the hooks you list
      },
      // Step types available to workflows. The built-in tasks are not
      // registered automatically: pass the ones you want to use.
      steps: [
        HttpRequestStepTask,
        CreateDocumentStepTask,
        ReadDocumentStepTask,
        UpdateDocumentStepTask,
        DeleteDocumentStepTask,
        SendEmailStepTask,
      ],
    }),
  ],
})
```

Then, in the admin panel, create a trigger in **Automation Triggers**, a step in **Automation Steps**, and a **Workflow** that references both. SQL adapters (Postgres, SQLite) need a migration for the new collections (`payload migrate:create`).

## Imports

```typescript
// Plugin, step tasks and server functions
import { workflowsPlugin, triggerWorkflowById, retryWorkflowRun } from '@xtr-dev/payload-automation/server'

// Admin components (used by the plugin's collections)
import { StatusCell, ErrorDisplay, ReadOnlyBanner } from '@xtr-dev/payload-automation/client'

// Types only
import type { WorkflowsPluginConfig, SeedWorkflow, TriggerResult } from '@xtr-dev/payload-automation'
```

## Collections

| Collection | Slug | Description |
|------------|------|-------------|
| Triggers | `automation-triggers` | Reusable trigger definitions: collection hook, global hook, scheduled, webhook, manual |
| Steps | `automation-steps` | Reusable step definitions: a step type plus its `config` (input) |
| Workflows | `workflows` | References triggers and steps; each workflow step has a `slug`, optional `inputOverrides`, `condition` and `dependencies` |
| Workflow Runs | `workflow-runs` | Execution history |

Collection hook and global hook triggers share one `hook` field. Globals have fewer hooks than collections (`afterChange`, `afterRead`, `beforeValidate`, `beforeChange`, `beforeRead`, `beforeOperation`), so saving a global hook trigger with any other hook, such as `afterDelete`, is refused with a validation error on `hook`.

### Hooks and database transactions

Payload runs collection and global hooks inside the database transaction of the operation that fired them, when the database uses transactions: always on Postgres, on MongoDB when it is a replica set, and on SQLite only with the adapter's `transactionOptions`.

A workflow triggered from a hook inside a transaction starts when that transaction has committed:

- Its steps see the committed document, and a `workflow-runs` document exists only for operations that really happened.
- If the operation fails and is rolled back, no workflow starts and no run is stored.
- The operation still waits for the workflow (with the default `execution.mode: 'inline'`): `payload.create()` or the REST request returns after the last step, as it does without transactions.
- When several operations share one transaction (you pass the same `req` to nested Local API calls), their workflows all start when the outermost operation commits, in the order they were triggered.
- This also holds for the `before*` hooks: with a transaction, a workflow triggered by `beforeChange` runs after the change is stored. The trigger `condition` is still evaluated in the hook, on the hook's arguments.

Without a transaction (SQLite by default, a standalone MongoDB, hooks of read operations) the workflow runs inside the hook as before.

With `execution.mode: 'queue'` nothing is deferred: the `pending` run and its job are written inside the transaction, so they are stored or rolled back together with the operation, and the steps run later in your job runner.

A trigger's `condition` and a workflow step's `condition` are bare JSONata expressions (no `{{ }}`). A trigger whose condition is false skips the workflow; a step whose condition is false is recorded as `skipped`.

## Expressions

Step inputs use JSONata. A string is evaluated only when the **whole** value is wrapped in `{{ }}`; anything else is passed through as a literal. To build a string, concatenate inside one expression:

```typescript
{
  to: '{{trigger.doc.email}}',
  subject: '{{"Order " & trigger.doc.id & " confirmed"}}',
  body: { orderId: '{{trigger.doc.id}}', total: '{{$sum(trigger.doc.items.price)}}' },
  // Not evaluated: 'Order {{trigger.doc.id}} confirmed'
}
```

Objects and arrays are evaluated value by value.

### Available Context

| Path | Description |
|------|-------------|
| `trigger.type` | `'collection'`, `'global'`, `'webhook'`, `'scheduled'`, or the trigger type passed to `triggerWorkflowById` / `triggerCustomWorkflow` |
| `trigger.doc`, `trigger.previousDoc`, `trigger.operation` | Hook arguments, as Payload passes them to the hook |
| `trigger.collection` / `trigger.global` | Slug of the collection or global |
| `trigger.req` | `{ user, locale, fallbackLocale }` only; the rest of the request is not exposed |
| `trigger.body`, `trigger.query` | Webhook JSON body (also as `trigger.doc`) and query parameters |
| `trigger.scheduledAt`, `trigger.firedAt` | Scheduled triggers (see [Scheduled Triggers](#scheduled-triggers)) |
| `trigger.data` | Data passed to `triggerWorkflowById` / `triggerCustomWorkflow` |
| `trigger.firedTrigger` | The `automation-triggers` document that fired |
| `steps.<slug>.output`, `steps.<slug>.state` | Output and state (`succeeded`, `failed`, `skipped`) of an earlier step |

Steps are keyed by their `slug`, and also by their display name. Hyphenated slugs must be backtick-quoted, because JSONata parses an unquoted `-` as subtraction: `` {{steps.`fetch-user`.output.name}} ``.

### Custom Functions

| Function | Description |
|----------|-------------|
| `$now()` / `$timestamp()` | Current time as an ISO string / in ms |
| `$uuid()` | UUID v4 |
| `$default(value, fallback)` | `fallback` when `value` is null or undefined |
| `$coalesce(a, b, ...)` | First non-null value |
| `$json(string)` / `$stringify(value)` | Parse / serialize JSON |
| `$keys(obj)`, `$values(obj)`, `$has(obj, key)` | Object helpers |
| `$env('PUBLIC_*')` | Environment variables with a `PUBLIC_` prefix only |

Expressions time out after 5 seconds. See the [JSONata docs](https://docs.jsonata.org) for the built-in functions.

## Step Dependencies

Each workflow step has a `slug`. `dependencies` lists the slugs a step waits for; steps whose dependencies are done run together in parallel.

A workflow's step slugs must be unique and not empty. Saving a workflow in which two steps share a slug, through the admin panel, REST, GraphQL or the Local API (drafts included), is refused with a validation error on the `slug` field of the later step, for example `steps.2.slug: The slug "fetch" is already used by step 1 of this workflow`. Slugs are compared exactly, so `Fetch` and `fetch` are different. The check runs when a workflow is created and when an update changes its step slugs. A workflow stored with duplicate slugs by an earlier version is not touched: it keeps running as before and can still be saved, until its step slugs are changed, and then they have to be unique.

```typescript
steps: [
  { name: 'Fetch User', slug: 'fetch-user', type: 'http-request-step', input: { url: 'https://api.example.com/user' } },
  { name: 'Fetch Orders', slug: 'fetch-orders', type: 'http-request-step', input: { url: 'https://api.example.com/orders' } },
  {
    name: 'Generate Report',
    slug: 'generate-report',
    type: 'http-request-step',
    dependencies: ['fetch-user', 'fetch-orders'],
    input: {
      url: 'https://api.example.com/reports',
      method: 'POST',
      body: {
        user: '{{steps.`fetch-user`.output.data}}',
        orders: '{{steps.`fetch-orders`.output.data}}',
      },
    },
  },
]
```

A dependency on a slug that doesn't exist, or a cycle, fails the run. When a step fails (after its last retry, see [Retries and Timeout](#retries-and-timeout)), the workflow's `errorHandling` decides what happens: `stop` (default) and `retry` fail the run, `continue` runs the remaining independent steps and skips the steps that depend on the failed one, directly or through other skipped steps. A skipped step is recorded with status `skipped` and an `output.reason` such as `Dependency "fetch-user" failed`. A dependent step with its own `condition` is not skipped automatically; its condition decides, so a step with `dependencies: ['fetch-user']` and the condition `` steps.`fetch-user`.state = 'failed' `` runs only when `fetch-user` fails. The run ends as `completed`.

Step outputs are captured as the task handler returns, so they work with Payload's default `jobs.deleteJobOnComplete: true`. The exception is a task whose `handler` is a module path string (or a task added to the config after this plugin runs): its output is read back from the job, so it is only available when completed jobs are kept (`deleteJobOnComplete: false`).

## Retries and Timeout

### Retries

A failed step can be retried. Which settings apply to a step:

| Step (`automation-steps`) | Workflow `errorHandling` | Retries |
|---|---|---|
| `retryOnFailure: true` | any | the step's `maxRetries` and `retryDelay` |
| `retryOnFailure: false` (default) | `retry` | the workflow's `maxRetries` and `retryDelay` |
| `retryOnFailure: false` (default) | `stop` or `continue` | none |

- `maxRetries` is the number of retries after the first attempt, so `3` means up to 4 attempts. Empty means 3; `0` means no retries. A step with `retryOnFailure: true` and `maxRetries: 0` is never retried, also in a workflow with `errorHandling: 'retry'`.
- `retryDelay` is the wait before each retry in milliseconds (empty means 1000). The delay is fixed; there is no backoff.
- A step only counts as failed after its last attempt failed. Only then does `errorHandling` apply: `stop` fails the run, `continue` skips the step's dependents and carries on, and `retry` fails the run like `stop`. So `errorHandling: 'retry'` is `stop` plus a default retry policy for every step of the workflow.
- Every attempt is a separate job in `payload-jobs` with the same resolved input; the step's condition and input expressions are evaluated once, before the first attempt.
- The step result on the run records `attempts`, `retryCount` (`attempts - 1`) and `lastError`, the error of the most recent failed attempt, which is kept when a later attempt succeeds. Each failed attempt that is retried also adds a `warn` entry to the run's `logs`.
- The plugin does the retrying, not Payload: `retries` on a task's own config is ignored for a task run as a workflow step, and the job of a failed attempt is cancelled so a job runner does not run it again outside the run. The `http-request-step` inputs `retries` and `retryDelay` are separate: they repeat the HTTP request inside one attempt.

Where the delay is spent depends on the [execution mode](#plugin-configuration):

- `inline` (default): the run waits inside the hook or call that fired the trigger, for every delay. Keep `maxRetries × retryDelay` short, or use queue mode.
- `queue`: a delay up to `execution.maxInProcessRetryDelay` (default 5000 ms) is waited inside the `automation-workflow-run` job. For a longer delay the run is saved with status `pending`, the waiting step gets `nextRetryAt`, and a new `automation-workflow-run` job is queued with Payload's `waitUntil`; the run continues from its stored step results when a job runner picks that job up, so no runner is blocked while waiting. The retry therefore happens at the first job-runner pass after `nextRetryAt`, and expressions of later steps see the stored (serialized) step outputs.

`retryWorkflowRun` (below) is something else: it starts a new run from a finished one.

### Timeout

A workflow's `timeout` (milliseconds, default `300000`; `0` or empty for no limit) limits the whole run, counted from the moment its steps start, including retries, retry delays and the time a queued run is paused for a retry. There is no per-step timeout.

When the time is up, the run ends as `failed` with the error `Workflow timed out after <n> ms`, whatever `errorHandling` is. Steps that were running are recorded as `failed` with a `Step timed out: ...` error, steps that had not started stay `pending`, and no further step or retry starts.

A running task handler cannot be interrupted: Payload gives task handlers no cancellation signal, so an HTTP request or database write already under way still finishes. The plugin cancels the step's job, so Payload discards its result and never runs it again, and whatever the handler returns later is not written to the run. Give long-running custom tasks their own limit (the `http-request-step` has a `timeout` input).

## Step Types

Steps are ordinary [Payload tasks](https://payloadcms.com/docs/jobs-queue/tasks) and run through Payload's job queue. The built-in ones:

| Type | Input |
|------|-------|
| `http-request-step` | `url`, `method` (GET, POST, PUT, DELETE, PATCH), `headers`, `body`, `timeout`, `authentication` (bearer, basic, API key header), `retries`, `retryDelay`. Output: `status`, `statusText`, `headers`, `body`, `data`, `duration` |
| `create-document` | `collectionSlug`, `data`, `draft`, `locale` |
| `read-document` | `collectionSlug`, `id` or `where`, `limit` (default 10), `sort`, `locale`, `depth`. Output: `docs` (always a list), `doc` (a single document: the one with that `id`, or the first match of `where`, `null` when nothing matched), `totalDocs` |
| `update-document` | `collectionSlug`, `id`, `data`, `draft`, `locale` |
| `delete-document` | `collectionSlug`, `id` or `where` |
| `send-email` | `to`, `from`, `subject`, `text`, `html`, `cc`, `bcc` (uses Payload's email adapter) |

### Custom Steps

Any `TaskConfig` works as a step:

```typescript
import type { TaskConfig } from 'payload'

export const SlackNotificationStep: TaskConfig<'slack-notification'> = {
  slug: 'slack-notification',
  label: 'Send Slack Message',
  inputSchema: [
    { name: 'channel', type: 'text', required: true },
    { name: 'message', type: 'textarea', required: true },
  ],
  outputSchema: [{ name: 'messageId', type: 'text' }],
  handler: async ({ input }) => {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: input.channel, text: input.message }),
    })
    const data = await response.json()
    return { output: { messageId: data.ts }, state: 'succeeded' }
  },
}

workflowsPlugin({ steps: [SlackNotificationStep] })
```

## Webhook Triggers

Create a trigger of type **Webhook** with a path and a secret, and reference it from a workflow. The plugin serves:

```
POST /api/automation/webhooks/<webhookPath>
```

Every request must carry the trigger's secret, in an `X-Webhook-Secret` header or as an `Authorization: Bearer` token. Requests without a valid secret get a 401 and start nothing:

```bash
curl -X POST https://your-app.com/api/automation/webhooks/my-webhook \
  -H "X-Webhook-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"orderId": "abc-123"}'
```

Only a SHA-256 hash of the secret is stored, so it is never returned by the API or shown again after saving. To rotate it, enter a new secret; leaving the field empty keeps the current one. Use a long random value (for example `openssl rand -hex 32`): a fast hash does not protect a short, guessable secret. Seeded webhook triggers take theirs from `parameters.webhookSecret`.

The response lists each workflow the call reached and whether it was `triggered`, `skipped` (condition false) or `failed`.

## Scheduled Triggers

A trigger of type **Scheduled (Cron)** runs its workflows on a cron expression (`schedule`, e.g. `0 9 * * *`; a leading seconds field is optional) in the trigger's `timezone` (an IANA name such as `Europe/Amsterdam`; empty means the server's timezone). Invalid expressions and timezones are rejected on save.

The plugin fires them from a Payload job task, `automation-scheduled-triggers`, which Payload's scheduler queues every `tick` (default every minute). **Nothing fires unless your app runs Payload's job queue with scheduling**, using one of:

```typescript
// Long-running server. The queue must match scheduledTriggers.queue ('default' unless set).
buildConfig({
  jobs: { autoRun: [{ cron: '* * * * *', queue: 'default' }] },
})
```

In a Next.js app, `jobs.autoRun` alone is not enough: Payload only starts the `autoRun` crons when it is loaded with `cron: true`. The admin panel loads it that way, a plain `getPayload({ config })` in your own server code does not, so after a restart nothing fires until someone opens `/admin`. Load Payload with `cron: true` when the server starts, from `instrumentation.ts` (in `src/` if your app uses it):

```typescript
// instrumentation.ts
export async function register() {
  // Payload needs Node.js; skip the Edge runtime, where register() also runs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { getPayload } = await import('payload')
  const { default: config } = await import('@payload-config')

  // Starts the autoRun crons once per server process; later getPayload calls reuse the instance.
  await getPayload({ config, cron: true })
}
```

Next.js bundles `instrumentation.ts` separately from your routes, so the plugin's code is loaded twice in the server process. That is supported: workflows started from a route or server action (`triggerWorkflowById`, `triggerCustomWorkflow`) work on the Payload instance that `register()` created, step outputs included.

Other ways to run the queue:

- Serverless: call `GET /api/payload-jobs/run?queue=default` from an external cron (e.g. Vercel Cron) at least as often as the tick. It requires a logged-in user by default, so set `jobs.access.run` to accept your cron's credentials (for example, compare the `Authorization` header with a `CRON_SECRET` environment variable).
- Your own runner: `await payload.jobs.handleSchedules()` then `await payload.jobs.run()`. Or skip Payload's scheduler and call `runScheduledTriggers(payload)` from `@xtr-dev/payload-automation/server`.

How firing works:

- On each tick, every trigger whose next occurrence after its `lastFiredAt` has passed fires once. Each occurrence is claimed with an atomic update first, so overlapping ticks and multiple server instances don't fire it twice. Firing is at most once: a crash between the claim and the run skips that occurrence.
- Occurrences missed during downtime fire once in total, not once each. A new or changed schedule starts counting from the save time, so past occurrences are never backfilled.
- Occurrences that pass while a workflow is disabled, or whose condition is false, are consumed, not fired later.
- Every fired occurrence stores a run. A trigger condition is evaluated before any step runs and only sees the schedule's own data, so it cannot skip a tick that turns out to have nothing to do; use the workflow's [`discardRunWhen`](#keeping-idle-runs-out-of-the-history) to keep those runs out of the history.
- Precision is the tick: with the default, up to about a minute late.

Expressions see `trigger.type` (`'scheduled'`), `trigger.scheduledAt` (the occurrence being fired), `trigger.firedAt`, `trigger.previousFiredAt`, `trigger.schedule`, `trigger.timezone` and `trigger.firedTrigger`.

Database schema: scheduled triggers add `timezone` and `last_fired_at` to `automation-triggers`, and the scheduled task makes Payload add its `payload-jobs-stats` global. Postgres and SQLite need a migration; MongoDB needs nothing.

## Keeping Fields Out of Runs

A collection or global hook hands the workflow the document as the Local API reads it: every field, including ones the collection hides from its own readers, such as a token with `access: { read: () => false }`. The run stores that document in `triggerData`, where everyone who may read `workflow-runs` sees it. `redactFields` leaves fields out:

```typescript
workflowsPlugin({
  redactFields: {
    // Per collection (or global) slug: dot paths of the fields to leave out.
    collections: { orders: ['accessToken', 'payment.token', 'items.secret'] },
    globals: { settings: ['apiSecret'] },
    // Also leave out every field the config itself restricts.
    hiddenFields: true,
  },
})
```

- A path through an array or blocks field applies to every row (`items.secret`). A path to a group, array or named tab removes it whole. Array indexes are not supported.
- `hiddenFields: true` adds, for every collection and global, the fields with `hidden: true` and the fields with an `access.read` function. The function is not called: a run is read by other people than the one who triggered it, so a field with read access control is left out for everybody. It is off by default because existing workflows may rely on such fields being stored.

What is removed, for collection hook and global hook triggers:

| Where | Effect |
|---|---|
| `triggerData`, `inputs` and `context` of the run | The fields are missing from `doc`, `previousDoc`, `originalDoc`, `data`, `args.data`, and from an afterOperation `result`, `result.doc` and `result.docs`. |
| Step inputs | A document, or part of one, that an expression copies as a whole (`{{trigger.doc}}`, `{{trigger.doc.payment}}`, `{{trigger}}`) reaches the step without the fields. So do the stored `stepResults`, the job in `payload-jobs` and the `debug` log of queued jobs. |
| Step outputs | For a step whose input has a `collectionSlug` and whose output has `doc` or `docs` (the built-in read, create, update and delete document steps), the fields listed for that collection are removed before Payload logs the output on the job, before it is stored on the run, and before later steps see it. |

What still works: with the default `execution.mode: 'inline'`, conditions and step inputs are evaluated against the live hook arguments, so a step that needs a redacted field can name it, `{{trigger.doc.accessToken}}`. That value is then an ordinary step input and is stored as one. With `execution.mode: 'queue'`, and in a run started by `retryWorkflowRun`, steps read the stored `triggerData`, so a redacted field is not available to them.

Set `hideFromExpressions: true` to drop the fields entirely: they are removed from the live context too, and no condition or step input can read them in any mode.

Not covered: the `data` of manual, webhook and scheduled triggers (it belongs to no collection), documents of other collections populated into the triggering document through a relationship, the output of custom steps with another shape, and runs stored before the option was set.

## Triggering From Code

Workflows with a trigger of type **Manual** can be started from server code:

```typescript
import { triggerWorkflowById, triggerCustomWorkflow } from '@xtr-dev/payload-automation/server'

// One workflow. The data is available as trigger.data.
const result = await triggerWorkflowById(payload, workflowId, 'manual', { source: 'import' })
if (result.status === 'failed') {
  console.error(result.error, result.runId)
}

// Every enabled workflow with a manual trigger
const results = await triggerCustomWorkflow(payload, { data: { source: 'import' } })
```

`triggerCustomWorkflow` only starts workflows with a **Manual** trigger. Trigger types are fixed (collection hook, global hook, scheduled, webhook, manual); there are no custom trigger types. To give a group of workflows their own event, give them a manual trigger and tell them apart with a trigger `condition` on the data you pass, for example `trigger.data.source = "import"`.

Call both outside a database transaction. They run the steps before they return, so they cannot wait for a commit: on Postgres, passing a `req` that belongs to an open transaction (the `req` of a collection hook, for example) makes every step fail, because Payload's job runner cannot see the step's job until that transaction commits. Leave `req` out there, or use `execution.mode: 'queue'`.

`triggerWorkflowById` throws, without creating a run, when the workflow doesn't exist, has no trigger of that type, or is disabled. Once a run exists it resolves to `{ status: 'triggered' | 'failed', runId, workflowId, workflowName, error?, discarded? }` instead of throwing (`discarded` is explained under [Keeping Idle Runs Out of the History](#keeping-idle-runs-out-of-the-history)).

## Execution Tracking

Every execution is stored in `workflow-runs` with the trigger data, per-step results (slug, name, status, input, output, error, duration, attempts, lastError), logs and the final status. `findStepResult(run.stepResults, slug)` from `/server` picks one step's result by slug; runs stored before step results recorded their slug are matched on the step name instead (pass it as a third argument when it differs from the slug). Postgres and SQLite need a migration for the `slug`, `attempts`, `last_error` and `next_retry_at` columns on the step results table; MongoDB needs nothing.

```typescript
const runs = await payload.find({
  collection: 'workflow-runs',
  where: { workflow: { equals: workflowId }, status: { equals: 'completed' } },
  sort: '-createdAt',
})
```

A run always ends as `failed` when it fails, even if the write that records the failure is rejected (a hook on `workflow-runs` throws, or a step result no longer fits the schema). The plugin then stores only `status`, `completedAt` and `error`, and `error` says that the step results, context and logs are missing and why. If a hook rejects that write too, the three fields are written through the database adapter, so `workflow-runs` hooks do not run for it.

### Keeping Idle Runs Out of the History

A workflow that polls for work, such as a scheduled workflow whose step usually finds nothing, stores a run on every tick. To keep only the runs that did something, give the workflow a `discardRunWhen` expression (the **Run History** section of the workflow in the admin panel, or `discardRunWhen` on a [seeded workflow](#seeding-template-workflows)):

```typescript
{
  slug: 'release-unpaid-orders',
  name: 'Release unpaid orders',
  triggers: [{ type: 'scheduled', parameters: { schedule: '* * * * *' } }],
  steps: [{ name: 'Release', slug: 'release', type: 'release-unpaid-orders' }],
  // The custom step returns output: { released: <number of orders> }
  discardRunWhen: 'steps.release.output.released = 0',
}
```

It is a bare JSONata expression (no `{{ }}`) with the same [context](#available-context) as a step condition, evaluated once all steps have finished. When it is true, the run is deleted from `workflow-runs` instead of being stored as `completed`. With the built-in read step, `$count(steps.find.output.docs) = 0` does the same; `steps.notify.state = "skipped"` discards runs in which a conditional step did not run.

- The default is empty: every run is kept.
- A run that failed, and a run that completed with a failed step (`errorHandling: 'continue'`), is always kept.
- An expression that fails to evaluate counts as false, so the run is kept.
- The run exists while it is in progress, so it can show up in the history until it finishes. The step jobs of a discarded run that are still in `payload-jobs` (all of them with `jobs.deleteJobOnComplete: false`, otherwise only the jobs of failed attempts) are deleted with it.
- `triggerWorkflowById`, `triggerCustomWorkflow` and `runScheduledTriggers` report a discarded run with `discarded: true`; its `runId` no longer refers to a stored run. In queue mode the run is discarded later, by the job that runs its steps, so the result of the call does not have the flag.
- `retryWorkflowRun` always keeps the run it returns.
- Postgres and SQLite need a migration for the `discard_run_when` column on the workflows table (and its versions table); MongoDB needs nothing.

### Retrying a Run

`retryWorkflowRun` runs the workflow again from a run's stored `triggerData` and returns the new `workflow-runs` document. The original run is not changed. A step that fails again doesn't make the call throw; check `status` on the returned run.

```typescript
import { retryWorkflowRun } from '@xtr-dev/payload-automation/server'

// Run every step again
const rerun = await retryWorkflowRun(payload, failedRunId)

// Or reuse the stored output of the steps that already succeeded
const resumed = await retryWorkflowRun(payload, failedRunId, { resumeFromFailedStep: true })
```

With `resumeFromFailedStep`, a succeeded step is only reused when it is at the same position, references the same step document and has the same slug as in the original run (runs stored before step results recorded their slug skip the slug check). The retry uses the workflow's current definition and does not check the trigger condition again. It refuses runs that are still `pending` or `running`, and always runs inline, also with `execution: { mode: 'queue' }`.

## Seeding Template Workflows

`seedWorkflows` creates read-only workflows (with their triggers and steps) on startup:

```typescript
import type { SeedWorkflow } from '@xtr-dev/payload-automation'

const seedWorkflows: SeedWorkflow[] = [
  {
    slug: 'example-welcome-email',
    name: 'Example: Send Welcome Email',
    triggers: [
      {
        type: 'collection-hook',
        parameters: { collectionSlug: 'users', hook: 'afterChange' },
        condition: 'trigger.operation = "create"',
      },
    ],
    steps: [
      {
        name: 'Send Email',
        slug: 'send-email',
        type: 'send-email',
        input: {
          to: '{{trigger.doc.email}}',
          subject: 'Welcome!',
          text: '{{"Thanks for joining, " & trigger.doc.email}}',
        },
        // Optional: retry this step with its own settings.
        retryOnFailure: true,
        maxRetries: 2,
        retryDelay: 5000,
      },
    ],
    // Optional workflow settings.
    errorHandling: 'continue',
    timeout: 60000,
  },
]

workflowsPlugin({ seedWorkflows, steps: [SendEmailStepTask] })
```

A step can declare `retryOnFailure`, `maxRetries` and `retryDelay`, a workflow `errorHandling`, `maxRetries`, `retryDelay` and `timeout` (see [Retries and Timeout](#retries-and-timeout)) and `discardRunWhen` (see [Keeping Idle Runs Out of the History](#keeping-idle-runs-out-of-the-history)). A setting you leave out gets its default when the workflow is created and is not touched afterwards.

On every startup a seeded workflow is matched by `slug` and, when its definition in code has changed, updated in place. A trigger whose fields changed (but not its type) keeps its document, so earlier runs still link to it, unless another workflow shares that trigger. Step slugs (by default the slugified step name) must be unique within a workflow; a definition where two steps share one is rejected with a `Failed to seed workflow` error. Seeded workflows can't be updated or deleted through the admin UI or API. See [docs/SEEDING_WORKFLOWS.md](./docs/SEEDING_WORKFLOWS.md) for the full format.

## Plugin Configuration

```typescript
type WorkflowsPluginConfig = {
  // false returns the Payload config unchanged. Default: true.
  enabled?: boolean

  // Collections/globals whose hooks can fire triggers. `true` registers
  // afterChange, afterDelete and afterRead (globals: afterChange, afterRead);
  // an object registers only the hooks set to true. Unknown hook names log a warning.
  collectionTriggers?: { [slug: string]: true | { [hook: string]: true } }
  globalTriggers?: { [slug: string]: true | { [hook: string]: true } }

  // Step types available to workflows (Payload TaskConfig objects).
  steps?: TaskConfig[]

  // Read-only workflows created on startup (see "Seeding Template Workflows").
  seedWorkflows?: SeedWorkflow[]

  // Per-collection access overrides (see "Access Control").
  access?: Partial<Record<
    'workflows' | 'automation-triggers' | 'automation-steps' | 'workflow-runs',
    Partial<CollectionConfig['access']>
  >>

  // 'inline' (default) runs the steps inside the hook or call that fired the
  // trigger, so that request waits for them (a hook inside a database
  // transaction starts them once it has committed, see "Hooks and database
  // transactions"). 'queue' records a pending run and
  // queues one `automation-workflow-run` job on `queue` (default 'default');
  // the steps run when your job runner processes it, using the stored
  // triggerData snapshot and the job runner's request.
  // maxInProcessRetryDelay (ms, default 5000, queue mode only): a step retry
  // delay longer than this pauses the run and re-queues it with `waitUntil`
  // instead of waiting inside the job. See "Retries and Timeout".
  execution?: { mode?: 'inline' | 'queue'; queue?: string; maxInProcessRetryDelay?: number }

  // The automation-scheduled-triggers task, scheduled every `tick`
  // (default '* * * * *') on `queue` (default 'default'). false registers no
  // task; scheduled triggers then only fire via runScheduledTriggers(payload).
  scheduledTriggers?: false | { tick?: string; queue?: string }

  // Leave user objects (req.user, the trigger's `user`, afterMe's
  // response.user, ...) out of what is stored on workflow-runs, and store
  // triggeredBy as `<collection>:<id>`. Step input expressions then also see
  // those users as undefined; conditions still see them. Default: false.
  stripUserData?: boolean

  // Fields of the triggering document to keep out of workflow-runs and
  // payload-jobs, per collection or global slug, as dot paths. See "Keeping
  // Fields Out of Runs". Default: none.
  redactFields?: {
    collections?: Record<string, string[]>
    globals?: Record<string, string[]>
    hiddenFields?: boolean        // also fields with `hidden: true` or `access.read`
    hideFromExpressions?: boolean // also hide them from conditions and step inputs
  }

  // How long (ms) hook handlers cache the list of hook triggers. Edits through
  // this Payload instance clear it immediately; the TTL bounds how long edits
  // from other processes take to apply. 0 disables caching. Default: 60000.
  triggerCacheTTL?: number

  // Extra info-level logging of queued step jobs.
  debug?: boolean
}
```

`redactFields` keeps fields of your own collections out of runs, see [Keeping Fields Out of Runs](#keeping-fields-out-of-runs). Independent of `stripUserData` and `redactFields`, auth secrets (`hash`, `salt`, `password`, reset and verification tokens, API keys) are removed from step inputs, outputs and stored runs, and session tokens are never stored. Stripping works on object keys: a scalar you pick out explicitly (`{{trigger.previousDoc.hash}}`) is stored like any value, and a task's own output in its `payload-jobs` log is written by Payload as-is.

## Access Control

By default every operation on the automation collections, reads included, requires a user who can access /admin: a user from `config.admin.user` who also passes that collection's `access.admin`, if defined. Workflows run HTTP requests and document writes with your application's privileges, step configs can hold credentials, and runs hold response bodies, so a user from any other auth collection is not enough. The plugin's own reads and writes (seeding, execution) use the Local API and are unaffected.

Override any operation per collection; operations without an override keep the default:

```typescript
workflowsPlugin({
  access: {
    'automation-steps': {
      read: ({ req }) => Boolean(req.user),
    },
  },
})
```

Read-only (seeded) workflows, and the triggers and steps they reference, can't be updated or deleted through the API. An `update` or `delete` override doesn't lift that lock: the plugin ANDs it with your function.

## Upgrading

### Workflows triggered inside a transaction run after the commit

Hosts on Postgres, on a MongoDB replica set, or on SQLite with `transactionOptions`: a workflow triggered from a collection or global hook now starts when the triggering operation's transaction has committed, and not at all when it is rolled back (see [Hooks and database transactions](#hooks-and-database-transactions)). On Postgres such workflows failed at their first step before; on MongoDB with transactions they ran inside the hook, so steps could act on a change that was later rolled back, and a workflow on a `before*` hook ran before the change was written. No schema change.


### The `position` field on workflow steps was removed

Each entry of `workflows.steps` had a hidden `position` field of type `point`, left over from a visual builder that no longer exists. Nothing read it. On Postgres a `point` field is a PostGIS `geometry` column, so the plugin could not create its schema on a server without the PostGIS extension.

The field is gone, which changes the database schema:

- **Postgres and SQLite with migrations:** run `payload migrate:create` and apply the result. It drops the `position` column from `workflows_steps` and `_workflows_v_version_steps`. Stored values are deleted with the column.
- **Postgres and SQLite in push mode** (development): Payload drops the two columns on the next start and asks for confirmation because data is removed.
- **MongoDB:** nothing to do. Values already stored stay in the documents and are ignored.

Payload does not remove the PostGIS extension from a database that already has it. If nothing else in your project uses a `point` field, you can drop it yourself with `DROP EXTENSION postgis`.

## Logging

```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=debug pnpm dev
```

Levels: `silent` | `error` | `warn` (default) | `info` | `debug` | `trace`

## License

MIT
