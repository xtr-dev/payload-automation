# @xtr-dev/payload-automation

[![npm version](https://badge.fury.io/js/@xtr-dev%2Fpayload-automation.svg)](https://www.npmjs.com/package/@xtr-dev/payload-automation)

A workflow automation plugin for PayloadCMS 3.x. Run steps in workflows triggered by document changes or webhooks.

⚠️ **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0. Not recommended for production use.

## Features

- 🔄 Visual workflow builder in PayloadCMS admin
- ⚡ Run workflows when documents are created/updated/deleted
- 🎯 Trigger workflows via webhooks
- 📊 Track workflow execution history
- 🔧 HTTP requests, document operations, email sending
- 🔗 Use data from previous steps in templates

## Installation

```bash
npm install @xtr-dev/payload-automation
# or
pnpm add @xtr-dev/payload-automation
# or
yarn add @xtr-dev/payload-automation
```

## Quick Start

```typescript
import { buildConfig } from 'payload'
import { workflowsPlugin } from '@xtr-dev/payload-automation/server'

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
import type { WorkflowsPluginConfig } from '@xtr-dev/payload-automation'
```

## Step Types

### HTTP Request
Call external APIs. Supports GET, POST, PUT, DELETE, PATCH. Uses Bearer tokens, API keys, or basic auth.

HTTP steps succeed even with 4xx/5xx status codes. Only network errors (timeouts, DNS failures) cause step failure. Check `{{steps.stepName.output.status}}` for error handling.

### Document Operations
- **Create Document** - Create PayloadCMS documents
- **Read Document** - Query documents with filters
- **Update Document** - Modify existing documents  
- **Delete Document** - Remove documents

### Communication
- **Send Email** - Send notifications via PayloadCMS email

## Templates

Use `{{}}` to insert data:

- `{{trigger.doc.id}}` - Data from the document that triggered the workflow  
- `{{steps.stepName.output}}` - Data from previous steps

Example:
```json
{
  "url": "https://api.example.com/posts/{{steps.createPost.output.id}}",
  "condition": "{{trigger.doc.status}} == 'published'"
}
```

## Requirements

- PayloadCMS ^3.45.0
- Node.js ^18.20.2 || >=20.9.0
- pnpm ^9 || ^10

## Logging

Set `PAYLOAD_AUTOMATION_LOG_LEVEL` to control logs:
- `silent`, `error`, `warn` (default), `info`, `debug`, `trace`

```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=debug npm run dev
```

## Scheduled Workflows

Use webhook triggers with external cron services:

```bash
# Call workflow webhook from cron
curl -X POST https://your-app.com/api/workflows-webhook/daily-report
```

Built-in cron triggers were removed in v0.0.37+.

## License

MIT
