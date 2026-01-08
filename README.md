# @xtr-dev/payload-automation

[![npm version](https://badge.fury.io/js/@xtr-dev%2Fpayload-automation.svg)](https://www.npmjs.com/package/@xtr-dev/payload-automation)

A workflow automation plugin for PayloadCMS 3.x. Build visual workflows triggered by document changes, webhooks, or manual execution.

> **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0.

## Features

- **Visual Workflow Builder** - Drag-and-drop workflow editor in PayloadCMS admin
- **Workflow Visualizer** - React component for displaying workflows with real-time execution status
- **Collection Triggers** - Run workflows when documents are created, updated, or deleted
- **Webhook Triggers** - Trigger workflows via HTTP endpoints
- **Step Dependencies** - Define execution order with parallel and sequential steps
- **Execution Tracking** - Full history with step-by-step results, duration, and logs
- **Built-in Steps** - HTTP requests, document CRUD, email sending
- **Custom Steps** - Create your own step types with the step factory
- **JSONata Expressions** - Powerful data transformation between steps

## Installation

```bash
pnpm add @xtr-dev/payload-automation
# or
npm install @xtr-dev/payload-automation
```

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { workflowsPlugin } from '@xtr-dev/payload-automation'

export default buildConfig({
  plugins: [
    workflowsPlugin({
      enabled: true,
      collectionTriggers: {
        orders: true,  // Enable all hooks for orders
        users: {
          afterChange: true,  // Only specific hooks
        }
      },
      // Register custom steps
      steps: [myCustomStep],
    }),
  ],
})
```

## Imports

```typescript
// Main plugin
import { workflowsPlugin } from '@xtr-dev/payload-automation'

// Client components (for custom UIs)
import {
  WorkflowVisualizer,
  useExecutionStream,
  type ExecutionStatus
} from '@xtr-dev/payload-automation/client'

// Built-in step definitions
import {
  HttpRequestStepTask,
  CreateDocumentStepTask,
  UpdateDocumentStepTask,
  DeleteDocumentStepTask,
  ReadDocumentStepTask,
} from '@xtr-dev/payload-automation/steps'

// Step factory for custom steps
import { createStep } from '@xtr-dev/payload-automation/steps'

// Types
import type { WorkflowsPluginConfig } from '@xtr-dev/payload-automation'
```

## Workflow Visualizer

Display workflows in your frontend with real-time execution status:

```tsx
import { WorkflowVisualizer } from '@xtr-dev/payload-automation/client'

function WorkflowDemo({ workflow }) {
  return (
    <WorkflowVisualizer
      workflow={{
        name: workflow.name,
        steps: workflow.steps.map(step => ({
          stepName: step.name,
          stepType: step.type,
          description: step.description,
          dependencies: step.dependencies,
        })),
      }}
      executionStatus={{
        status: 'running',  // 'pending' | 'running' | 'completed' | 'failed'
        stepResults: [
          { stepIndex: 0, status: 'succeeded', duration: 150 },
          { stepIndex: 1, status: 'running' },
          { stepIndex: 2, status: 'pending' },
        ],
      }}
      height={500}
      showMiniMap={false}
      showControls={true}
    />
  )
}
```

The visualizer automatically:
- Positions nodes based on dependencies (layered layout)
- Shows step descriptions and types
- Animates execution status with color-coded states
- Displays duration for completed steps

## Built-in Steps

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

Create reusable step types with the `createStep` factory:

```typescript
import { createStep } from '@xtr-dev/payload-automation/steps'

export const SlackNotificationStep = createStep({
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

  visual: {
    icon: '💬',
    color: '#4A154B',
  },

  validate: (input) => {
    if (!input.channel?.startsWith('#')) {
      throw new Error('Channel must start with #')
    }
  },

  execute: async (input, req) => {
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
      messageId: data.message.ts,
      timestamp: new Date().toISOString(),
    }
  },
})
```

Register custom steps in the plugin config:

```typescript
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

  // Custom step definitions
  steps?: StepDefinition[]
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
