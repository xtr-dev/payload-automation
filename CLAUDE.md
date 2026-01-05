# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **PayloadCMS Automation Plugin** that provides comprehensive workflow automation capabilities for PayloadCMS applications. The plugin enables users to create, execute, and manage complex workflows with visual workflow building, execution tracking, and various step types including HTTP requests, document operations, and email notifications.

## Payload Documentation

A local copy of the PayloadCMS documentation is available at `./payload-docs/` for offline reference and to ensure compatibility with the specific version used in this project.

## Development Commands

### Essential Commands
- `pnpm dev` - Start development server with Next.js (runs on http://localhost:3000, fallback ports used if occupied)
- `pnpm build` - Build the plugin for production (runs copyfiles, build:types, build:swc)
- `pnpm test` - Run tests (currently configured for integration and e2e)
- `pnpm test:int` - Run integration tests
- `pnpm test:e2e` - Run end-to-end tests
- `pnpm lint` - Run ESLint
- `pnpm lint:fix` - Auto-fix ESLint issues

### Development Workflow Commands
- `pnpm dev:generate-types` - Generate PayloadCMS types
- `pnpm dev:generate-importmap` - Generate import maps
- `pnpm dev:payload` - Run PayloadCMS CLI commands

### Build Commands
- `pnpm build:swc` - Transpile TypeScript with SWC
- `pnpm build:types` - Generate TypeScript declarations
- `pnpm copyfiles` - Copy static assets to dist directory
- `pnpm clean` - Clean build artifacts

## Architecture

### Plugin Structure
This follows the standard PayloadCMS plugin architecture:

- **Plugin Entry Point** (`src/plugin/index.ts`): Main plugin function that extends PayloadCMS config
- **Export System**: Multiple export paths for different use cases:
  - `.` (main): Core plugin functionality
  - `./client`: Client-side components and utilities
  - `./rsc`: React Server Components
  - `./fields`: Custom field exports
  - `./views`: Admin interface views
- **Development Environment** (`dev/`): Test PayloadCMS application for plugin development

### Core Concepts

1. **Triggers** (separate collection `automation-triggers`):
   - Reusable trigger definitions shared across workflows
   - Types: collection-hook, global-hook, scheduled, webhook, manual
   - Support conditions with JSONata expressions
   - Usage tracking for dependency management

2. **Steps** (separate collection `automation-steps`):
   - Reusable step templates that can be used across workflows
   - Step configuration with visual properties (color, icon)
   - Built-in retry configuration
   - Usage tracking for dependency management

3. **Workflows** (`workflows` collection):
   - References triggers and steps via relationships
   - Steps array with workflow-specific overrides (inputOverrides)
   - Error handling configuration (stop, continue, retry)
   - Version tracking with drafts

4. **Workflow Runs** (`workflow-runs` collection):
   - Tracks which trigger fired
   - Structured step results (not raw JSON)
   - Execution logs with timestamps and levels
   - Duration tracking

### Step Types
Available step types (registered via plugin config):
- `http-request-step`: External API calls
- `create-document`: Create PayloadCMS documents
- `read-document`: Query PayloadCMS documents
- `update-document`: Modify PayloadCMS documents
- `delete-document`: Remove PayloadCMS documents
- `send-email`: Email notifications via PayloadCMS email system

### JSONata Expression System

The plugin uses **JSONata** for safe, sandboxed expression evaluation. JSONata is a lightweight query and transformation language for JSON data, similar to XPath for XML.

**Why JSONata:**
- Pure JavaScript - works on Vercel, Cloudflare, AWS Lambda, etc.
- Safe sandboxing - no access to Node.js APIs or filesystem
- Powerful data transformation capabilities
- Used by Node-RED and other enterprise tools

#### Condition Examples

```javascript
// Simple comparisons
trigger.doc._status = "published"
trigger.doc.count > 10

// Logical operators
trigger.doc._status = "published" and trigger.doc.author.role = "editor"
trigger.doc.priority = "high" or trigger.doc.urgent = true

// Check if value exists
$exists(trigger.doc.metadata.tags)
$exists(steps.validate.output.error) = false

// Array operations
$count(trigger.doc.tags) > 0
trigger.doc.tags[category = "featured"]
```

#### Data Transformation Examples

```javascript
// Object construction
{
  "id": trigger.doc.id,
  "title": $uppercase(trigger.doc.title),
  "slug": $lowercase($replace(trigger.doc.title, " ", "-"))
}

// Array filtering and mapping
trigger.doc.items[price > 100].name
trigger.doc.tags.({"tag": $, "upper": $uppercase($)})

// Aggregations
$sum(trigger.doc.items.price)
$average(trigger.doc.ratings)
```

#### Available Context Variables

- `trigger.doc` - The document that triggered the workflow
- `trigger.type` - The trigger type ('collection' or 'global')
- `trigger.collection` - The collection slug (for collection triggers)
- `trigger.firedTrigger` - Reference to the trigger that fired
- `steps.<stepName>.output` - Output from a completed step
- `steps.<stepName>.state` - State of a step ('succeeded', 'failed', 'pending', 'skipped')

#### Custom Functions

The expression engine provides additional custom functions:

| Function | Description | Example |
|----------|-------------|---------|
| `$now()` | Current ISO timestamp | `$now()` |
| `$timestamp()` | Current Unix timestamp (ms) | `$timestamp()` |
| `$uuid()` | Generate UUID v4 | `$uuid()` |
| `$default(value, default)` | Return default if null | `$default(trigger.doc.title, "Untitled")` |
| `$json(string)` | Parse JSON string | `$json(trigger.doc.metadata)` |
| `$stringify(value)` | Convert to JSON string | `$stringify(trigger.doc)` |
| `$keys(object)` | Get object keys | `$keys(trigger.doc)` |
| `$values(object)` | Get object values | `$values(trigger.doc)` |
| `$has(object, key)` | Check if key exists | `$has(trigger.doc, "metadata")` |
| `$coalesce(a, b, ...)` | First non-null value | `$coalesce(trigger.doc.title, trigger.doc.name, "Unknown")` |
| `$env(name)` | Get env var (PUBLIC_ prefix only) | `$env("PUBLIC_API_URL")` |

#### JSONata Reference

Full JSONata documentation: https://docs.jsonata.org/

Common built-in functions:
- String: `$uppercase`, `$lowercase`, `$trim`, `$substring`, `$replace`, `$split`, `$join`
- Numeric: `$sum`, `$average`, `$min`, `$max`, `$round`, `$abs`
- Array: `$count`, `$append`, `$sort`, `$reverse`, `$filter`, `$map`
- Object: `$keys`, `$values`, `$merge`, `$spread`
- Boolean: `$not`, `$exists`

### Creating Steps

Steps can be created using the `createStep` factory:

```typescript
import { createStep } from '@xtr-dev/payload-automation/steps'

export const myStep = createStep({
  slug: 'my-step',
  label: 'My Custom Step',
  inputSchema: [{ name: 'url', type: 'text', required: true }],
  outputSchema: [{ name: 'result', type: 'json' }],
  validate: (input) => {
    if (!input.url) throw new Error('URL is required')
  },
  execute: async (input, req) => {
    const response = await fetch(input.url as string)
    return { result: await response.json() }
  }
})
```

### Collections

| Collection | Slug | Description |
|------------|------|-------------|
| Triggers | `automation-triggers` | Reusable trigger definitions |
| Steps | `automation-steps` | Reusable step templates |
| Workflows | `workflows` | Workflow definitions with trigger/step relationships |
| Workflow Runs | `workflow-runs` | Execution history with structured results |

### Key Architecture Components

#### Expression Engine (`src/core/expression-engine.ts`)
- JSONata-based expression evaluation
- Expression caching for performance
- Custom function registration
- Timeout protection (5s default)

#### Workflow Execution Engine (`src/core/workflow-executor.ts`)
- **WorkflowExecutor Class**: Core execution engine with dependency resolution
- **Step Resolution**: Loads base step config and merges with workflow overrides
- **Topological Sorting**: Handles step dependencies for parallel execution
- **Context Management**: Maintains execution state and data flow

#### Plugin Configuration (`src/plugin/`)
- **index.ts**: Main plugin configuration and lifecycle management
- **config-types.ts**: TypeScript definitions for plugin options
- **trigger-hook.ts**: Unified hook handler for collection and global triggers

#### Hook Options (`src/triggers/hook-options.ts`)
Grouped hook options for better admin UX:
- Document Lifecycle (afterChange, afterDelete, afterRead)
- Before Operations (beforeValidate, beforeChange, beforeDelete, beforeRead)
- Authentication (afterLogin, afterLogout, beforeLogin, etc.)
- Advanced (beforeOperation, afterOperation, afterError)

## Development Environment

### Database Configuration
- **Development**: SQLite adapter for simplicity
- Database selection in `dev/payload.config.ts`

### Plugin Development Pattern
- Uses spread syntax to extend existing PayloadCMS config
- Maintains database schema consistency when plugin is disabled
- Proper async/await handling for onInit extensions
- Endpoint registration at config time (not runtime)

## Build System
- **SWC** for fast TypeScript transpilation
- **TypeScript** for type generation with strict settings
- **copyfiles** for asset management
- Exports configured for both development and production
- Peer dependency on PayloadCMS 3.37.0

## Environment Variables

```bash
# Log level for the automation plugin
PAYLOAD_AUTOMATION_LOG_LEVEL=info  # debug | info | warn | error
```

## Dependencies

### Runtime
- PayloadCMS 3.37.0 as peer dependency
- JSONata for expression evaluation (serverless-compatible)
- Node.js ^18.20.2 || >=20.9.0
- pnpm ^9 || ^10 package manager

### Key Development Dependencies
- Next.js 15.4.4 for development server
- SWC for fast transpilation
- Various PayloadCMS adapters (SQLite, MongoDB, PostgreSQL)
- @xyflow/react for visual workflow builder

## Important Files for Understanding

- `src/plugin/index.ts` - Main plugin configuration and extension logic
- `src/core/expression-engine.ts` - JSONata expression evaluation engine
- `src/core/workflow-executor.ts` - Core execution engine with step resolution
- `src/collections/Triggers.ts` - Trigger collection definition
- `src/collections/Steps.ts` - Step collection definition
- `src/collections/Workflow.ts` - Workflow collection with relationships
- `src/collections/WorkflowRuns.ts` - Execution tracking with structured results
- `src/triggers/hook-options.ts` - Grouped hook options for admin UX
- `dev/payload.config.ts` - Development configuration showing plugin integration
