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
- `pnpm test` - Run all tests (integration + e2e)
- `pnpm test:int` - Run integration tests with Vitest
- `pnpm test:e2e` - Run end-to-end tests with Playwright
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

1. **Workflows**: Visual workflow definitions with steps and triggers
2. **Workflow Runs**: Execution instances of workflows with tracking
3. **Triggers**: Various ways to initiate workflows:
   - Collection hooks (create, update, delete, read)
   - Global hooks (global document updates)
   - Webhook triggers (external HTTP requests)
   - Manual execution
4. **Steps**: Individual workflow actions with dependency management:
   - HTTP requests
   - Document CRUD operations (create, read, update, delete)
   - Email notifications
   - Conditional logic and data transformation
5. **Parallel Execution**: Steps can run in parallel when dependencies allow
6. **JSONPath Integration**: Dynamic data interpolation using JSONPath Plus

### Key Architecture Components

#### Workflow Execution Engine (`src/core/workflow-executor.ts`)
- **WorkflowExecutor Class**: Core execution engine with dependency resolution
- **Topological Sorting**: Handles step dependencies for parallel execution
- **Context Management**: Maintains execution state and data flow
- **Error Handling**: Comprehensive error tracking and logging

#### Plugin Configuration (`src/plugin/`)
- **index.ts**: Main plugin configuration and lifecycle management
- **config-types.ts**: TypeScript definitions for plugin options
- **init-collection-hooks.ts**: Collection hook registration
- **init-global-hooks.ts**: Global hook registration
- **init-step-tasks.ts**: Step task registration

#### Collections (`src/collections/`)
- **Workflow.ts**: Main workflow collection with steps and triggers
- **WorkflowRuns.ts**: Execution tracking and history

#### Steps Library (`src/steps/`)
Each step type follows a consistent pattern:
- `{step-name}.ts`: TaskConfig definition with input/output schemas
- `{step-name}-handler.ts`: Handler function implementation

Available step types:
- HTTP Request: External API calls
- Create Document: Create PayloadCMS documents
- Read Document: Query PayloadCMS documents
- Update Document: Modify PayloadCMS documents
- Delete Document: Remove PayloadCMS documents
- Send Email: Email notifications via PayloadCMS email system

### JSONPath Data Resolution
The plugin uses JSONPath Plus for dynamic data interpolation:
- `$.trigger.doc.id` - Access trigger document data
- `$.steps.stepName.output` - Access previous step outputs
- Supports complex queries and transformations

### Dependency Management
Steps support a `dependencies` field (array of step names) that:
- Creates execution order through topological sorting
- Enables parallel execution within dependency batches
- Prevents circular dependencies

## Development Environment

### Database Configuration
- **Development**: SQLite adapter for simplicity
- **Testing**: MongoDB Memory Server for isolation
- Database selection in `dev/payload.config.ts`

### Testing Strategy
- **Integration Tests** (`dev/int.spec.ts`): Vitest with 30-second timeouts
- **E2E Tests** (`dev/e2e.spec.ts`): Playwright testing against development server
- **Test Database**: MongoDB Memory Server for isolated testing

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

## Important Implementation Notes

### Endpoint Registration
Custom endpoints must be registered during plugin configuration, not in onInit hooks. The webhook endpoint pattern:
```typescript
config.endpoints.push({
  path: '/workflows/webhook/:path',
  method: 'post',
  handler: async (req) => { /* handler logic */ }
})
```

### Step Handler Pattern
All step handlers follow this signature:
```typescript
export const stepHandler: TaskHandler<'step-name'> = async ({ input, req }) => {
  // validation, processing, and execution
  return {
    output: { /* results */ },
    state: 'succeeded' | 'failed'
  }
}
```

### Hook Integration
The plugin registers hooks for collections and globals specified in the plugin configuration, enabling automatic workflow triggering based on document operations.

## Dependencies

### Runtime
- PayloadCMS 3.37.0 as peer dependency
- jsonpath-plus for dynamic data resolution
- Node.js ^18.20.2 || >=20.9.0
- pnpm ^9 || ^10 package manager

### Key Development Dependencies
- Next.js 15.4.4 for development server
- Vitest + Playwright for testing
- SWC for fast transpilation
- Various PayloadCMS adapters (SQLite, MongoDB, PostgreSQL)

## Important Files for Understanding

- `src/plugin/index.ts` - Main plugin configuration and extension logic
- `src/core/workflow-executor.ts` - Core execution engine with dependency resolution
- `src/collections/Workflow.ts` - Workflow collection schema and configuration
- `dev/payload.config.ts` - Development configuration showing plugin integration
- `dev/int.spec.ts` and `dev/e2e.spec.ts` - Testing patterns and setup