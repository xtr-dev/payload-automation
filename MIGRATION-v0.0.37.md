# Migration Guide: v0.0.36 to v0.0.37

## Overview

Version 0.0.37 introduces significant refactoring and cleanup changes focused on simplifying the plugin architecture and removing unused features. This version removes several deprecated components and consolidates trigger handling.

## Breaking Changes

### 1. Removed Components and Files

The following components and modules have been completely removed:

#### Components
- `TriggerWorkflowButton` - Manual workflow triggering component
- `WorkflowExecutionStatus` - Workflow execution status display component

#### Plugin Modules  
- `init-global-hooks.ts` - Global hook initialization (functionality moved to main plugin)
- `init-step-tasks.ts` - Step task initialization (functionality integrated elsewhere)  
- `init-webhook.ts` - Webhook initialization (functionality removed)
- `init-workflow-hooks.ts` - Workflow hook initialization (functionality moved to main plugin)

#### Triggers
- `webhook-trigger.ts` - Webhook trigger support has been removed
- `cron-trigger.ts` - Cron/scheduled trigger support has been removed
- `cron-scheduler.ts` - Cron scheduling system has been removed

#### Tests
- `webhook-triggers.spec.ts` - Webhook trigger integration tests

### 2. Cron/Scheduled Workflows Removal

Cron trigger functionality has been completely removed from the plugin. If you were using cron triggers in your workflows:

**Migration Path:**
- Use external scheduling services like GitHub Actions or Vercel Cron
- Trigger workflows via webhook endpoints from external schedulers
- Implement custom scheduling in your application using libraries like `node-cron`

**Example with GitHub Actions:**
```yaml
name: Trigger Workflow
on:
  schedule:
    - cron: '0 9 * * *' # Daily at 9 AM
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Workflow
        run: |
          curl -X POST https://your-app.com/api/workflows/trigger/your-workflow-id
```

### 3. Webhook Trigger Removal

Webhook triggers have been removed. If you were using webhook triggers:

**Migration Path:**
- Implement custom webhook endpoints in your PayloadCMS application
- Use collection or global hooks to trigger workflows based on document changes
- Create manual trigger endpoints using the workflow executor directly

### 4. Architecture Changes

#### ExecutorRegistry Removal
The `executorRegistry` singleton pattern has been removed. WorkflowExecutor instances are now created on-demand for each execution.

**What this means:**
- No shared state between workflow executions
- Each execution is completely independent
- Better memory management and isolation

#### Hook Registration Consolidation
Hook registration logic has been consolidated into the main plugin file:
- Collection hooks are now registered directly in `plugin/index.ts`
- Global hooks are handled through the new `plugin/global-hook.ts` module
- Simplified hook management with better TypeScript typing

## Non-Breaking Changes

### 1. Trigger Module Refactoring

Triggers have been reorganized into a dedicated `triggers/` directory with improved modularity:

- `triggers/collection-trigger.ts` - Collection-based triggers
- `triggers/global-trigger.ts` - Global document triggers  
- `triggers/index.ts` - Trigger exports
- `triggers/types.ts` - Trigger type definitions

### 2. Field Helper Improvements

New `triggerField` helper function standardizes virtual field creation across all trigger modules:

```typescript
// Before (manual virtual field creation)
{
  name: '__builtin_collection',
  type: 'text',
  admin: { hidden: true },
  virtual: true,
  access: { read: () => false, update: () => false }
}

// After (using helper)
triggerField('collection', {
  type: 'text',
  // helper handles virtual field setup automatically
})
```

### 3. TypeScript Improvements

- Replaced 'any' types with proper TypeScript types
- Added `CollectionAfterChangeHook` and `PayloadRequest` type usage
- Improved type safety throughout the codebase

### 4. Code Organization

#### New File Structure
```
src/
├── plugin/
│   ├── collection-hook.ts    # Collection hook logic
│   ├── global-hook.ts        # Global hook logic (new)
│   └── index.ts             # Main plugin (consolidated)
├── triggers/                 # Trigger modules (new directory)
├── fields/
│   └── parameter.ts         # Moved from triggers/helpers.ts
```

#### ESLint Configuration
- Disabled `perfectionist/sort-object-types` and `perfectionist/sort-objects` rules
- Allows natural object property ordering without enforced alphabetical sorting

## Migration Steps

### 1. Update Imports

If you were importing removed components or modules, remove these imports:

```typescript
// Remove these imports - no longer available
import { TriggerWorkflowButton } from '@xtr-dev/payload-automation/client'
import { WorkflowExecutionStatus } from '@xtr-dev/payload-automation/client'
```

### 2. Update Workflow Configurations

If your workflows used cron or webhook triggers, you'll need to modify them:

**Before:**
```javascript
{
  trigger: {
    type: 'cron',
    schedule: '0 9 * * *'
  }
}
```

**After:**
```javascript
{
  trigger: {
    type: 'collection', // Use collection or global triggers instead
    collection: 'your-collection',
    operation: 'create'
  }
}
```

### 3. Replace Webhook Functionality

If you were using webhook triggers, implement custom webhook handling:

```typescript
// In your PayloadCMS config
export default buildConfig({
  endpoints: [
    {
      path: '/trigger-workflow/:workflowId',
      method: 'post',
      handler: async (req) => {
        const { workflowId } = req.params
        // Implement your workflow triggering logic here
        // Use the WorkflowExecutor directly if needed
      }
    }
  ]
})
```

### 4. Update Custom Components

If you built custom components using the removed ones as reference, update them to work with the new architecture.

## Benefits of This Release

1. **Simplified Architecture**: Consolidated plugin initialization reduces complexity
2. **Better Memory Management**: On-demand executor creation eliminates shared state issues  
3. **Improved Type Safety**: Proper TypeScript typing throughout
4. **Reduced Bundle Size**: Removal of unused code reduces package size
5. **Better Maintainability**: Cleaner code organization and module structure
6. **More Reliable**: External scheduling is more robust than in-process cron jobs

## Testing Your Migration

After migrating:

1. **Test Existing Workflows**: Ensure collection and global triggers still work as expected
2. **Verify External Triggers**: Test any external webhook or scheduling implementations
3. **Check Custom Components**: Validate any custom UI components that interact with workflows
4. **Run Integration Tests**: Execute your test suite to catch any breaking changes

## Support

If you encounter issues migrating from v0.0.36 to v0.0.37:

1. Check that you're not using any of the removed components or features
2. Verify your workflow trigger types are supported (collection, global, manual)
3. Update any custom integrations that relied on removed modules
4. Consider the external scheduling alternatives for cron functionality

For additional support, please refer to the plugin documentation or open an issue in the project repository.