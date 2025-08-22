# PayloadCMS Workflows Plugin Examples

This directory contains example code demonstrating how to use the PayloadCMS Workflows plugin.

## Manual Trigger Example

The `manual-trigger-example.ts` file shows how to:
- Create a workflow with a manual trigger button in the admin UI
- Trigger workflows programmatically using custom triggers
- Access trigger data in workflow steps using JSONPath

### Setting up a Manual Trigger Workflow

1. Configure the plugin with a custom trigger:
```typescript
workflowsPlugin({
  triggers: [
    {
      slug: 'manual-trigger',
      inputs: []  // No inputs needed for simple manual triggers
    }
  ],
  // ... other config
})
```

2. Create a workflow with the manual trigger:
```typescript
await payload.create({
  collection: 'workflows',
  data: {
    name: 'My Manual Workflow',
    triggers: [
      {
        type: 'manual-trigger'
      }
    ],
    steps: [
      // Your workflow steps here
    ]
  }
})
```

3. The workflow will now have a "Trigger Workflow" button in the admin UI

### Triggering Workflows Programmatically

```typescript
import { triggerCustomWorkflow } from '@xtr-dev/payload-automation'

// Trigger all workflows with 'manual-trigger'
const results = await triggerCustomWorkflow(payload, {
  slug: 'manual-trigger',
  data: {
    // Custom data to pass to the workflow
    source: 'api',
    timestamp: new Date().toISOString()
  }
})
```

### Accessing Trigger Data in Steps

Use JSONPath expressions to access trigger data in your workflow steps:
- `$.trigger.data.source` - Access custom data fields
- `$.trigger.type` - The trigger type
- `$.trigger.triggeredAt` - When the trigger was activated