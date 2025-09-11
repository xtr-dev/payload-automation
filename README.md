# @xtr-dev/payload-automation

A comprehensive workflow automation plugin for PayloadCMS 3.x that enables visual workflow building, execution tracking, and parallel processing.

⚠️ **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0. Not recommended for production use.

## Features

- 🔄 **Visual Workflow Builder** - Create complex workflows with drag-and-drop interface
- ⚡ **Parallel Execution** - Smart dependency resolution for optimal performance
- 🎯 **Multiple Triggers** - Collection hooks, webhooks, manual execution
- ⏰ **Scheduled Workflows** - Use webhook triggers with external cron services
- 📊 **Execution Tracking** - Complete history and monitoring of workflow runs
- 🔧 **Extensible Steps** - HTTP requests, document CRUD, email notifications
- 🔧 **Handlebars Templates** - Dynamic data interpolation with automatic type conversion

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

## Import Structure

The plugin uses separate exports to avoid bundling server-side code in client bundles:

```typescript
// Server-side plugin and functions
import { workflowsPlugin } from '@xtr-dev/payload-automation/server'

// Client-side components  
import { StatusCell, ErrorDisplay } from '@xtr-dev/payload-automation/client'

// Helper utilities
import { /* helpers */ } from '@xtr-dev/payload-automation/helpers'

// Types only (safe for both server and client)
import type { WorkflowsPluginConfig } from '@xtr-dev/payload-automation'
```

## Step Types

### HTTP Request
Make external API calls with comprehensive error handling and retry logic.

**Key Features:**
- Support for GET, POST, PUT, DELETE, PATCH methods
- Authentication: Bearer token, Basic auth, API key headers
- Configurable timeouts and retry logic
- Handlebars templates for dynamic URLs and request bodies

**Error Handling:**
HTTP Request steps use a **response-based success model** rather than status-code-based failures:

- ✅ **Successful completion**: All HTTP requests that receive a response (including 4xx/5xx status codes) are marked as "succeeded"
- ❌ **Failed execution**: Only network errors, timeouts, DNS failures, and connection issues cause step failure
- 📊 **Error information preserved**: HTTP error status codes (404, 500, etc.) are captured in the step output for workflow conditional logic

**Example workflow logic:**
```typescript
// Step outputs for a 404 response:
{
  "status": 404,
  "statusText": "Not Found", 
  "body": "Resource not found",
  "headers": {...},
  "duration": 1200
}

// Use in workflow conditions:
// "{{steps.apiRequest.output.status}} >= 400" to handle errors
```

This design allows workflows to handle HTTP errors gracefully rather than failing completely, enabling robust error handling and retry logic.

**Enhanced Error Tracking:**
For network failures (timeouts, DNS errors, connection failures), the plugin provides detailed error information through an independent storage system that bypasses PayloadCMS's output limitations:

```typescript
// Timeout error details preserved in workflow context:
{
  "steps": {
    "httpStep": {
      "state": "failed",
      "error": "Task handler returned a failed state",
      "errorDetails": {
        "errorType": "timeout",
        "duration": 2006,
        "attempts": 1,
        "finalError": "Request timeout after 2000ms",
        "context": {
          "url": "https://api.example.com/data",
          "method": "GET",
          "timeout": 2000
        }
      },
      "executionInfo": {
        "completed": true,
        "success": false,
        "executedAt": "2025-09-04T15:16:10.000Z",
        "duration": 2006
      }
    }
  }
}

// Access in workflow conditions:
// "{{steps.httpStep.errorDetails.errorType}} == 'timeout'"
// "{{steps.httpStep.errorDetails.duration}} > 5000"
```

### Document Operations
- **Create Document** - Create PayloadCMS documents
- **Read Document** - Query documents with filters
- **Update Document** - Modify existing documents  
- **Delete Document** - Remove documents

### Communication
- **Send Email** - Send notifications via PayloadCMS email

## Data Resolution

Use Handlebars templates to access workflow data:

- `{{trigger.doc.id}}` - Access trigger document
- `{{steps.stepName.output}}` - Use previous step outputs
- `{{context}}` - Access workflow context

### Template Examples

```json
{
  "url": "https://api.example.com/posts/{{steps.createPost.output.id}}",
  "message": "Post {{trigger.doc.title}} was updated by {{trigger.req.user.email}}",
  "timeout": "{{steps.configStep.output.timeoutMs}}"
}
```

### Automatic Type Conversion

Handlebars templates automatically convert string results to appropriate types based on field names:

- **Numbers**: `timeout`, `retries`, `delay`, `port`, `count`, etc. → converted to numbers
- **Booleans**: `enabled`, `active`, `success`, `complete`, etc. → converted to booleans  
- **Numeric strings**: `"5000"` → `5000`, `"3.14"` → `3.14`

### Conditions

Conditions support Handlebars templates with comparison operators:

```json
{
  "condition": "{{trigger.doc.status}} == 'published'"
}
```

## Requirements

- PayloadCMS ^3.45.0
- Node.js ^18.20.2 || >=20.9.0
- pnpm ^9 || ^10

## Environment Variables

Control plugin logging with these environment variables:

### `PAYLOAD_AUTOMATION_LOG_LEVEL`
Controls both configuration-time and runtime logging. 
- **Values**: `silent`, `error`, `warn`, `info`, `debug`, `trace`
- **Default**: `warn`
- **Example**: `PAYLOAD_AUTOMATION_LOG_LEVEL=debug`

### `PAYLOAD_AUTOMATION_CONFIG_LOG_LEVEL` (optional)
Override log level specifically for configuration-time logs (plugin setup).
- **Values**: Same as above
- **Default**: Falls back to `PAYLOAD_AUTOMATION_LOG_LEVEL` or `warn`
- **Example**: `PAYLOAD_AUTOMATION_CONFIG_LOG_LEVEL=silent`

### Production Usage
For production, keep the default (`warn`) or use `error` or `silent`:
```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=error npm start
```

### Development Usage
For debugging, use `debug` or `info`:
```bash
PAYLOAD_AUTOMATION_LOG_LEVEL=debug npm run dev
```

## Scheduled Workflows

For scheduled workflows, use **webhook triggers** with external cron services instead of built-in cron triggers:

### GitHub Actions (Free)
```yaml
# .github/workflows/daily-report.yml
on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM UTC
jobs:
  trigger-workflow:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST https://your-app.com/api/workflows-webhook/daily-report
```

### Vercel Cron (Serverless)
```js
// api/cron/daily.js
export default async function handler(req, res) {
  await fetch('https://your-app.com/api/workflows-webhook/daily-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'vercel-cron' })
  });
  res.status(200).json({ success: true });
}
```

**Benefits**: Better reliability, proper process isolation, easier debugging, and leverages existing infrastructure.

**Note**: Built-in cron triggers have been removed in v0.0.37+ to focus on webhook-based scheduling which provides better reliability and debugging capabilities.

## Documentation

Full documentation coming soon. For now, explore the development environment in the repository for examples and patterns.

## License

MIT