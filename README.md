# @xtr-dev/payload-automation

[![npm version](https://badge.fury.io/js/@xtr-dev%2Fpayload-automation.svg)](https://www.npmjs.com/package/@xtr-dev/payload-automation)

A workflow automation plugin for PayloadCMS 3.x. Workflows are configured in the admin panel and run when documents change, on a cron schedule, from a webhook, or from your own code.

> **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0.

## Features

- Run workflows from collection and global hooks, cron schedules, authenticated webhooks, or code
- Built-in steps for HTTP requests, document CRUD and email; any Payload task can be a step
- JSONata expressions for step inputs and conditions, including output from earlier steps
- Step dependencies: independent steps run in parallel, dependent ones in order
- Inline or queued (Payload job queue) execution
- Run history in `workflow-runs`, with retry from a stored run
- Read-only template workflows seeded from code

## Requirements

- PayloadCMS ^3.79.1
- Node.js ^18.20.2 || >=20.9.0
- React ^19.0.0 (for client components; declared as a peer dependency)

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

A dependency on a slug that doesn't exist, or a cycle, fails the run. When a step fails, the workflow's `errorHandling` decides what happens: `stop` (default) fails the run, `continue` runs the remaining independent steps and skips the steps that depend on the failed one, directly or through other skipped steps. A skipped step is recorded with status `skipped` and an `output.reason` such as `Dependency "fetch-user" failed`. A dependent step with its own `condition` is not skipped automatically; its condition decides, so a step with `dependencies: ['fetch-user']` and the condition `` steps.`fetch-user`.state = 'failed' `` runs only when `fetch-user` fails. The run ends as `completed`.

Step outputs are captured as the task handler returns, so they work with Payload's default `jobs.deleteJobOnComplete: true`. The exception is a task whose `handler` is a module path string (or a task added to the config after this plugin runs): its output is read back from the job, so it is only available when completed jobs are kept (`deleteJobOnComplete: false`).

## Step Types

Steps are ordinary [Payload tasks](https://payloadcms.com/docs/jobs-queue/tasks) and run through Payload's job queue. The built-in ones:

| Type | Input |
|------|-------|
| `http-request-step` | `url`, `method` (GET, POST, PUT, DELETE, PATCH), `headers`, `body`, `timeout`, `authentication` (bearer, basic, API key header), `retries`, `retryDelay`. Output: `status`, `statusText`, `headers`, `body`, `data`, `duration` |
| `create-document` | `collectionSlug`, `data`, `draft`, `locale` |
| `read-document` | `collectionSlug`, `id` or `where`, `limit`, `sort`, `locale`, `depth` |
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

- Serverless: call `GET /api/payload-jobs/run?queue=default` from an external cron (e.g. Vercel Cron) at least as often as the tick. It requires a logged-in user by default, so set `jobs.access.run` to accept your cron's credentials (for example, compare the `Authorization` header with a `CRON_SECRET` environment variable).
- Your own runner: `await payload.jobs.handleSchedules()` then `await payload.jobs.run()`. Or skip Payload's scheduler and call `runScheduledTriggers(payload)` from `@xtr-dev/payload-automation/server`.

How firing works:

- On each tick, every trigger whose next occurrence after its `lastFiredAt` has passed fires once. Each occurrence is claimed with an atomic update first, so overlapping ticks and multiple server instances don't fire it twice. Firing is at most once: a crash between the claim and the run skips that occurrence.
- Occurrences missed during downtime fire once in total, not once each. A new or changed schedule starts counting from the save time, so past occurrences are never backfilled.
- Occurrences that pass while a workflow is disabled, or whose condition is false, are consumed, not fired later.
- Precision is the tick: with the default, up to about a minute late.

Expressions see `trigger.type` (`'scheduled'`), `trigger.scheduledAt` (the occurrence being fired), `trigger.firedAt`, `trigger.previousFiredAt`, `trigger.schedule`, `trigger.timezone` and `trigger.firedTrigger`.

Database schema: scheduled triggers add `timezone` and `last_fired_at` to `automation-triggers`, and the scheduled task makes Payload add its `payload-jobs-stats` global. Postgres and SQLite need a migration; MongoDB needs nothing.

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
const results = await triggerCustomWorkflow(payload, { slug: 'manual', data: { source: 'import' } })
```

`triggerWorkflowById` throws, without creating a run, when the workflow doesn't exist, has no trigger of that type, or is disabled. Once a run exists it resolves to `{ status: 'triggered' | 'failed', runId, workflowId, workflowName, error? }` instead of throwing.

## Execution Tracking

Every execution is stored in `workflow-runs` with the trigger data, per-step results (status, input, output, error, duration), logs and the final status.

```typescript
const runs = await payload.find({
  collection: 'workflow-runs',
  where: { workflow: { equals: workflowId }, status: { equals: 'completed' } },
  sort: '-createdAt',
})
```

### Retrying a Run

`retryWorkflowRun` runs the workflow again from a run's stored `triggerData` and returns the new `workflow-runs` document. The original run is not changed. A step that fails again doesn't make the call throw; check `status` on the returned run.

```typescript
import { retryWorkflowRun } from '@xtr-dev/payload-automation/server'

// Run every step again
const rerun = await retryWorkflowRun(payload, failedRunId)

// Or reuse the stored output of the steps that already succeeded
const resumed = await retryWorkflowRun(payload, failedRunId, { resumeFromFailedStep: true })
```

The retry uses the workflow's current definition and does not check the trigger condition again. It refuses runs that are still `pending` or `running`, and always runs inline, also with `execution: { mode: 'queue' }`.

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
      },
    ],
  },
]

workflowsPlugin({ seedWorkflows, steps: [SendEmailStepTask] })
```

A workflow whose `slug` already exists is left as it is, so later changes in code are not applied to it. Seeded workflows can't be updated or deleted through the admin UI or API. See [docs/SEEDING_WORKFLOWS.md](./docs/SEEDING_WORKFLOWS.md) for the full format.

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
  // trigger, so that request waits for them. 'queue' records a pending run and
  // queues one `automation-workflow-run` job on `queue` (default 'default');
  // the steps run when your job runner processes it, using the stored
  // triggerData snapshot and the job runner's request.
  execution?: { mode?: 'inline' | 'queue'; queue?: string }

  // The automation-scheduled-triggers task, scheduled every `tick`
  // (default '* * * * *') on `queue` (default 'default'). false registers no
  // task; scheduled triggers then only fire via runScheduledTriggers(payload).
  scheduledTriggers?: false | { tick?: string; queue?: string }

  // Leave user objects (req.user, the trigger's `user`, afterMe's
  // response.user, ...) out of what is stored on workflow-runs, and store
  // triggeredBy as `<collection>:<id>`. Step input expressions then also see
  // those users as undefined; conditions still see them. Default: false.
  stripUserData?: boolean

  // How long (ms) hook handlers cache the list of hook triggers. Edits through
  // this Payload instance clear it immediately; the TTL bounds how long edits
  // from other processes take to apply. 0 disables caching. Default: 60000.
  triggerCacheTTL?: number

  // Extra info-level logging of queued step jobs.
  debug?: boolean
}
```

Independent of `stripUserData`, auth secrets (`hash`, `salt`, `password`, reset and verification tokens, API keys) are removed from step inputs, outputs and stored runs, and session tokens are never stored. Stripping works on object keys: a scalar you pick out explicitly (`{{trigger.previousDoc.hash}}`) is stored like any value, and a task's own output in its `payload-jobs` log is written by Payload as-is.

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

## Logging

```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=debug pnpm dev
```

Levels: `silent` | `error` | `warn` (default) | `info` | `debug` | `trace`

## License

MIT
