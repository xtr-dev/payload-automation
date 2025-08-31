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

- **HTTP Request** - Make external API calls
- **Create Document** - Create PayloadCMS documents
- **Read Document** - Query documents with filters
- **Update Document** - Modify existing documents
- **Delete Document** - Remove documents
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