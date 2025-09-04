# @xtr-dev/payload-automation

A comprehensive workflow automation plugin for PayloadCMS 3.x that enables visual workflow building, execution tracking, and parallel processing.

⚠️ **Pre-release Warning**: This package is currently in active development (v0.0.x). Breaking changes may occur before v1.0.0. Not recommended for production use.

## Features

- 🔄 **Visual Workflow Builder** - Create complex workflows with drag-and-drop interface
- ⚡ **Parallel Execution** - Smart dependency resolution for optimal performance
- 🎯 **Multiple Triggers** - Collection hooks, webhooks, manual execution
- 📊 **Execution Tracking** - Complete history and monitoring of workflow runs
- 🔧 **Extensible Steps** - HTTP requests, document CRUD, email notifications
- 🔍 **JSONPath Integration** - Dynamic data interpolation and transformation

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
import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'

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
- JSONPath integration for dynamic URLs and request bodies

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
// "$.steps.apiRequest.output.status >= 400" to handle errors
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
// "$.steps.httpStep.errorDetails.errorType == 'timeout'"
// "$.steps.httpStep.errorDetails.duration > 5000"
```

### Document Operations
- **Create Document** - Create PayloadCMS documents
- **Read Document** - Query documents with filters
- **Update Document** - Modify existing documents  
- **Delete Document** - Remove documents

### Communication
- **Send Email** - Send notifications via PayloadCMS email

## Data Resolution

Use JSONPath to access workflow data:

- `$.trigger.doc.id` - Access trigger document
- `$.steps.stepName.output` - Use previous step outputs
- `$.context` - Access workflow context

## Requirements

- PayloadCMS ^3.45.0
- Node.js ^18.20.2 || >=20.9.0
- pnpm ^9 || ^10

## Documentation

Full documentation coming soon. For now, explore the development environment in the repository for examples and patterns.

## License

MIT