# @xtr-dev/payload-automation

[![npm version](https://badge.fury.io/js/@xtr-dev%2Fpayload-automation.svg)](https://www.npmjs.com/package/@xtr-dev/payload-automation)

A workflow automation plugin for PayloadCMS 3.x. Build visual workflows triggered by document changes, webhooks, or manual execution.

> **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0.

## Features

- 🔄 Visual workflow builder in PayloadCMS admin
- ⚡ Run workflows when documents are created/updated/deleted
- 🎯 Trigger workflows via webhooks
- 📊 Track workflow execution history
- 🔧 HTTP requests, document operations, email sending
- 🔗 Use data from previous steps in templates
- ⚙️ Step dependencies with parallel and sequential execution

## Installation

```bash
pnpm add @xtr-dev/payload-automation
# or
npm install @xtr-dev/payload-automation
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
        posts: true,    // Enable all CRUD triggers for posts
        users: { 
          create: true, // Only enable create trigger for users
          update: true
        }
      },
      // Step types available to workflows. The built-in tasks are not
      // registered automatically — pass the ones you want to use.
      steps: [
        HttpRequestStepTask,
        CreateDocumentStepTask,
        ReadDocumentStepTask,
        UpdateDocumentStepTask,
        DeleteDocumentStepTask,
        SendEmailStepTask,
      ],
      enabled: true,
    }),
  ],
})
```

## Imports

```typescript
// Server plugin
import { workflowsPlugin } from '@xtr-dev/payload-automation/server'

// Client components  
import { StatusCell, ErrorDisplay } from '@xtr-dev/payload-automation/client'

// Types
import type { WorkflowsPluginConfig, SeedWorkflow } from '@xtr-dev/payload-automation'
```

## Seeding Template Workflows

Provide read-only example workflows for users to learn from and reference:

```typescript
import type { SeedWorkflow } from '@xtr-dev/payload-automation'

const exampleWorkflows: SeedWorkflow[] = [
  {
    slug: 'example-welcome-email',
    name: 'Example: Send Welcome Email',
    description: 'Send email when user is created',
    triggers: [
      {
        type: 'collection-hook',
        parameters: {
          collectionSlug: 'users',
          hook: 'afterChange',
        },
        condition: 'trigger.operation = "create"',
      },
    ],
    steps: [
      {
        name: 'Send Email',
        type: 'send-email',
        input: {
          to: '{{trigger.doc.email}}',
          subject: 'Welcome!',
          text: 'Thanks for joining us!',
        },
      },
    ],
  },
  {
    slug: 'example-order-processing',
    name: 'Example: Order Processing Pipeline',
    description: 'Process order with validation, inventory check, and notifications',
    triggers: [
      {
        type: 'collection-hook',
        parameters: {
          collectionSlug: 'orders',
          hook: 'afterChange',
        },
        condition: 'trigger.operation = "create"',
      },
    ],
    steps: [
      {
        name: 'Validate Order',
        slug: 'validate-order',  // Unique identifier for this step
        type: 'http-request-step',
        input: {
          url: 'https://api.example.com/validate',
          method: 'POST',
          body: {
            orderId: '{{trigger.doc.id}}',
            items: '{{trigger.doc.items}}',
          },
        },
      },
      {
        name: 'Check Inventory',
        slug: 'check-inventory',
        type: 'http-request-step',
        input: {
          url: 'https://api.example.com/inventory/check',
          method: 'POST',
          body: {
            items: '{{trigger.doc.items}}',
          },
        },
        // Dependencies reference other steps by slug
        dependencies: ['validate-order'],
      },
      {
        name: 'Create Shipment',
        slug: 'create-shipment',
        type: 'create-document',
        input: {
          collection: 'shipments',
          data: {
            orderId: '{{trigger.doc.id}}',
            status: 'pending',
            items: '{{trigger.doc.items}}',
          },
        },
        // This step waits for both validation and inventory check
        dependencies: ['validate-order', 'check-inventory'],
      },
      {
        name: 'Send Confirmation Email',
        slug: 'send-email',
        type: 'send-email',
        input: {
          to: '{{trigger.doc.customer.email}}',
          subject: 'Order Confirmed',
          text: 'Your order {{trigger.doc.id}} has been confirmed!',
        },
        // Dependencies reference step slugs
        dependencies: ['create-shipment'],
      },
    ],
  },
]

workflowsPlugin({
  seedWorkflows: exampleWorkflows,
  // ... other config
})
```

Seeded workflows:
- Are automatically created on first startup
- Use slug as unique identifier (stable across renames)
- Automatically update when definition changes in code
- Cannot be edited or deleted via UI or API
- Show a warning banner in the admin panel
- Can be duplicated to create editable versions

See [docs/SEEDING_WORKFLOWS.md](./docs/SEEDING_WORKFLOWS.md) for detailed documentation.

## Step Dependencies

Steps can declare dependencies on other steps to control execution order. Dependencies reference steps by their **slug** (not by name or index), making them stable across renames and reordering.

### How Dependencies Work

- **Parallel Execution**: Steps without dependencies run in parallel
- **Sequential Execution**: Steps with dependencies wait for their dependencies to complete successfully
- **Multiple Dependencies**: A step can depend on multiple other steps (all must succeed)
- **Failure Handling**: If a dependency fails, the dependent step is skipped
- **Slug-based**: Dependencies reference step `slug` fields, not names or positions

### Example: Parallel and Sequential Steps

```typescript
steps: [
  {
    name: 'Fetch User Data',
    slug: 'fetch-user',
    type: 'http-request-step',
    // No dependencies - runs immediately
  },
  {
    name: 'Fetch Order Data',
    slug: 'fetch-orders',
    type: 'http-request-step',
    // No dependencies - runs in parallel with fetch-user
  },
  {
    name: 'Generate Report',
    slug: 'generate-report',
    type: 'http-request-step',
    dependencies: ['fetch-user', 'fetch-orders'],  // Reference by slug
    // Waits for both API calls to complete
    input: {
      url: 'https://api.example.com/reports',
      body: {
        user: '{{steps.FetchUserData.output.user}}',
        orders: '{{steps.FetchOrderData.output.orders}}',
      },
    },
  },
]
```

### Accessing Step Output

Use `{{steps.<stepName>.output.<field>}}` to reference data from completed steps:

```typescript
{
  name: 'Process Result',
  slug: 'process-result',
  type: 'create-document',
  dependencies: ['api-call'],  // Reference by slug
  input: {
    collection: 'results',
    data: {
      // Access output from the "API Call" step
      apiResponse: '{{steps.APICall.output.data}}',
      status: '{{steps.APICall.output.status}}',
    },
  },
}
```

## Step Types

> **Note:** Steps are just regular [PayloadCMS tasks](https://payloadcms.com/docs/jobs/overview). This plugin uses Payload's built-in job queue system, so you can leverage all of Payload's task features including retries, scheduling, and monitoring. Any `TaskConfig` you create is a valid step.

The plugin comes with a few built-in step types found below.

### HTTP Request
Call external APIs with full configuration:

```typescript
{
  type: 'http-request-step',
  config: {
    url: 'https://api.example.com/webhook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"orderId": "{{trigger.doc.id}}"}'
  }
}
```

Supports GET, POST, PUT, DELETE, PATCH. Authentication via Bearer tokens, API keys, or basic auth.

### Document Operations

- **Create Document** - Create new PayloadCMS documents
- **Read Document** - Query documents with filters
- **Update Document** - Modify existing documents
- **Delete Document** - Remove documents

### Send Email
Send notifications via PayloadCMS email adapter:

```typescript
{
  type: 'send-email',
  config: {
    to: '{{trigger.doc.customer.email}}',
    subject: 'Order Confirmed',
    template: 'order-confirmation'
  }
}
```

## Custom Steps

Steps are standard PayloadCMS tasks, so creating custom steps is just defining a `TaskConfig`. No proprietary APIs to learn:

```typescript
import type { TaskConfig } from 'payload'

// Define the step configuration
export const SlackNotificationStep: TaskConfig<'slack-notification'> = {
  slug: 'slack-notification',
  label: 'Send Slack Message',

  inputSchema: [
    { name: 'channel', type: 'text', required: true },
    { name: 'message', type: 'textarea', required: true },
  ],

  outputSchema: [
    { name: 'messageId', type: 'text' },
    { name: 'timestamp', type: 'text' },
  ],

  handler: async ({ input, req }) => {
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: input.channel,
          text: input.message,
        }),
      })

      const data = await response.json()

      return {
        output: {
          messageId: data.message.ts,
          timestamp: new Date().toISOString(),
        },
        state: 'succeeded'
      }
    } catch (error) {
      return {
        output: {},
        state: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  },
}

// Register in plugin config
workflowsPlugin({
  steps: [SlackNotificationStep],
})
```

## JSONata Expressions

Use `{{expression}}` syntax for dynamic values. [JSONata](https://jsonata.org) provides powerful data transformation.

### Available Context

- `trigger.doc` - The document that triggered the workflow
- `trigger.type` - Trigger type ('collection' | 'global')
- `trigger.collection` - Collection slug for collection triggers
- `steps.<stepName>.output` - Output from a completed step
- `steps.<stepName>.state` - Step state ('succeeded' | 'failed' | 'pending' | 'skipped')

### Examples

```javascript
// Access trigger data
{{trigger.doc.id}}
{{trigger.doc.customer.email}}

// Use previous step output
{{steps.createOrder.output.id}}
{{steps.fetchUser.output.name}}

// Conditions (in step config)
{{trigger.doc.status = 'published'}}
{{trigger.doc.total > 100}}

// String transformation
{{$uppercase(trigger.doc.title)}}
{{$join(trigger.doc.tags, ', ')}}

// Object construction
{
  "orderId": "{{trigger.doc.id}}",
  "total": "{{$sum(trigger.doc.items.price)}}"
}
```

### Custom Functions

| Function | Description |
|----------|-------------|
| `$now()` | Current ISO timestamp |
| `$uuid()` | Generate UUID v4 |
| `$default(value, fallback)` | Return fallback if null |
| `$coalesce(a, b, ...)` | First non-null value |
| `$env('PUBLIC_*')` | Access PUBLIC_ env vars |

## Execution Tracking

All workflow executions are stored in the `workflow-runs` collection with:

- Trigger data that initiated the run
- Step-by-step results with status and duration
- Execution logs with timestamps
- Total duration and final status

Query runs programmatically:

```typescript
const runs = await payload.find({
  collection: 'workflow-runs',
  where: {
    workflow: { equals: workflowId },
    status: { equals: 'completed' },
  },
  sort: '-createdAt',
  limit: 10,
})
```

## Plugin Configuration

```typescript
interface WorkflowsPluginConfig {
  // Enable/disable the plugin
  enabled?: boolean

  // Collection triggers
  collectionTriggers?: {
    [collectionSlug: string]: boolean | {
      afterChange?: boolean
      afterDelete?: boolean
      afterRead?: boolean
      // ... other hooks
    }
  }

  // Global triggers
  globalTriggers?: {
    [globalSlug: string]: boolean | { /* hooks */ }
  }

  // Step types available to workflows (Payload TaskConfig objects).
  // Optional — without it the plugin registers its collections and hooks
  // but no step types. Built-in tasks are exported from
  // '@xtr-dev/payload-automation/server'.
  steps?: TaskConfig[]
}
```

## Requirements

- PayloadCMS ^3.37.0
- Node.js ^18.20.2 || >=20.9.0
- React 18+ (for client components)

## Logging

Control log verbosity with `PAYLOAD_AUTOMATION_LOG_LEVEL`:

```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=debug pnpm dev
```

Levels: `silent` | `error` | `warn` (default) | `info` | `debug` | `trace`

## Collections

The plugin creates these collections:

| Collection | Slug | Description |
|------------|------|-------------|
| Triggers | `automation-triggers` | Reusable trigger definitions |
| Steps | `automation-steps` | Step templates with configuration |
| Workflows | `workflows` | Workflow definitions |
| Workflow Runs | `workflow-runs` | Execution history |

## License

MIT
