# Seeding Read-Only Workflows

`seedWorkflows` creates template workflows on startup. They are marked `readOnly`, so users can look at them but not change or delete them.

## Behavior

- On each startup (`onInit`), every seed workflow whose `slug` doesn't exist yet is created, together with its triggers (in `automation-triggers`) and steps (in `automation-steps`).
- A workflow whose `slug` already exists is compared with its definition: `name`, `description`, triggers and steps. If nothing changed it is left alone. Otherwise it is updated in place: the workflow keeps its id, and triggers and steps that did not change keep theirs, so existing `workflow-runs` still point at them. Triggers are matched by position, steps by `slug`. A changed trigger or step is replaced by a new document and the old one is deleted, unless another workflow still uses it.
- Only those four fields are written. Other settings on the stored workflow (`enabled`, error handling) are kept. Removing a workflow from `seedWorkflows` does not delete it.
- If creating or updating a workflow fails partway, the triggers and steps created for that attempt are deleted again and an existing workflow stays as it was.
- Seeded workflows, and the triggers and steps they reference, can't be updated or deleted through the admin UI, REST, GraphQL or access-controlled Local API calls. The `readOnly` flag itself can only be set by the plugin's seeder.
- The admin panel shows a banner on read-only workflows.
- A seed that fails (for example an unknown step type) is logged as `Failed to seed workflow` and the others still run.

## Example

```typescript
import type { SeedWorkflow } from '@xtr-dev/payload-automation'
import {
  workflowsPlugin,
  CreateDocumentStepTask,
  HttpRequestStepTask,
  SendEmailStepTask,
} from '@xtr-dev/payload-automation/server'

const seedWorkflows: SeedWorkflow[] = [
  {
    slug: 'template-user-onboarding',
    name: 'Template: User Onboarding',
    description: 'Welcome email and profile for new users',
    triggers: [
      {
        type: 'collection-hook',
        parameters: { collectionSlug: 'users', hook: 'afterChange' },
        condition: 'trigger.operation = "create"',
      },
    ],
    steps: [
      {
        name: 'Send Welcome Email',
        slug: 'welcome-email',
        type: 'send-email',
        input: {
          to: '{{trigger.doc.email}}',
          subject: 'Welcome!',
          text: '{{"Thanks for joining, " & trigger.doc.email}}',
        },
      },
      {
        name: 'Create Profile',
        slug: 'create-profile',
        type: 'create-document',
        input: {
          collectionSlug: 'profiles',
          data: { user: '{{trigger.doc.id}}' },
        },
      },
      {
        name: 'Notify Admin',
        slug: 'notify-admin',
        type: 'http-request-step',
        dependencies: ['welcome-email', 'create-profile'],
        input: {
          url: 'https://api.example.com/notify',
          method: 'POST',
          body: { profileId: '{{steps.`create-profile`.output.id}}' },
        },
      },
    ],
  },
]

export default buildConfig({
  // ...
  plugins: [
    workflowsPlugin({
      collectionTriggers: { users: { afterChange: true } },
      steps: [CreateDocumentStepTask, HttpRequestStepTask, SendEmailStepTask],
      seedWorkflows,
    }),
  ],
})
```

## Format

```typescript
type SeedWorkflow = {
  slug: string          // Unique, stable identifier used to detect an existing seed
  name: string
  description?: string
  triggers: Array<{
    type: string        // 'collection-hook' | 'global-hook' | 'scheduled' | 'webhook' | 'manual'
    parameters?: Record<string, any>
    condition?: string  // Bare JSONata, no {{ }}
  }>
  steps: Array<{
    name: string
    slug?: string       // Defaults to the slugified name
    type: string        // A registered task slug, e.g. 'http-request-step'
    input?: Record<string, any>
    dependencies?: string[]  // Step slugs
    condition?: string  // Bare JSONata, no {{ }}
  }>
}
```

Trigger `parameters` by type:

| Type | Parameters |
|------|------------|
| `collection-hook` | `collectionSlug`, `hook` |
| `global-hook` | `globalSlug`, `hook` (one of the global hooks: `afterChange`, `afterRead`, `beforeValidate`, `beforeChange`, `beforeRead`, `beforeOperation`; a collection-only hook skips the workflow and logs `Failed to seed workflow`) |
| `scheduled` | `schedule` (cron expression), optional `timezone` (IANA name such as `Europe/Amsterdam`; default: the server's timezone). An invalid schedule or timezone skips the workflow and logs `Failed to seed workflow` |
| `webhook` | `webhookPath`, `webhookSecret` |
| `manual` | none |

The collections and globals a trigger listens to must also be listed in `collectionTriggers` / `globalTriggers`, or the hook is never registered.

Step `input` values follow the README's [expression rules](../README.md#expressions): a string is evaluated only when the whole value is wrapped in `{{ }}`, and step outputs are referenced by slug (backtick-quoted when it contains a hyphen).

## Troubleshooting

- **A seed was not created:** look for `Failed to seed workflow` in the logs (set `PAYLOAD_AUTOMATION_LOG_LEVEL=info` to also see `Seeded workflow: ...`). A unique-constraint error on `slug` means a workflow with that slug already exists.
- **Changes are not applied:** changes are applied on the next startup. If they are not, look for `Failed to seed workflow` in the logs; a failed update leaves the stored workflow as it was.
- **A step fails with `depends on non-existent step`:** `dependencies` must list step slugs, not names.
