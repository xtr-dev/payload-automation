# Seeding Read-Only Workflows

This guide explains how to seed read-only template workflows that users can reference but not modify or delete.

## Overview

The plugin supports seeding workflows through the `seedWorkflows` configuration option. Seeded workflows are automatically marked as read-only, preventing accidental modifications or deletions while providing users with template workflows they can learn from or duplicate.

## Features

- **Automatic Seeding**: Workflows are created on plugin initialization
- **Automatic Updates**: Workflows are updated when their definition changes in code
- **Slug-Based Matching**: Uses stable slug identifiers (workflow can be renamed freely)
- **Read-Only Protection**: Seeded workflows cannot be edited or deleted through the admin UI or API
- **Visual Indicators**: The admin UI clearly shows when a workflow is read-only with a warning banner
- **Change Detection**: Compares steps, triggers, name, and description to detect updates
- **Type-Safe**: Full TypeScript support with the `SeedWorkflow` type

## Configuration

Add the `seedWorkflows` array to your plugin configuration:

```typescript
import { workflowsPlugin, type SeedWorkflow } from '@xtr-dev/payload-automation/server'
import { httpRequestStep } from '@xtr-dev/payload-automation/server'

const exampleWorkflows: SeedWorkflow[] = [
  {
    slug: 'example-welcome-email',
    name: 'Example: Send Welcome Email',
    description: 'Automatically send a welcome email when a new user is created',
    triggers: [
      {
        type: 'collection',
        parameters: {
          collection: 'users',
          hook: 'afterChange',
        },
        condition: '$.trigger.doc.status == "active"',
      },
    ],
    steps: [
      {
        name: 'Send Welcome Email',
        type: 'send-email',
        input: {
          to: '$.trigger.doc.email',
          subject: 'Welcome to Our Platform!',
          text: 'Thank you for joining us, $.trigger.doc.name',
        },
      },
    ],
  },
  {
    slug: 'example-sync-to-api',
    name: 'Example: Sync to External API',
    description: 'Sync product data to an external inventory system',
    triggers: [
      {
        type: 'collection',
        parameters: {
          collection: 'products',
          hook: 'afterChange',
        },
      },
    ],
    steps: [
      {
        name: 'Prepare Product Data',
        type: 'transform-data',
        input: {
          data: '$.trigger.doc',
        },
      },
      {
        name: 'Sync to API',
        type: 'http-request',
        input: {
          url: 'https://api.example.com/inventory',
          method: 'POST',
          body: '$.steps.prepareData.output',
        },
        dependencies: ['Prepare Product Data'],
      },
    ],
  },
]

export default buildConfig({
  // ... other config
  plugins: [
    workflowsPlugin({
      steps: [httpRequestStep],
      seedWorkflows: exampleWorkflows,
      collectionTriggers: {
        users: true,
        products: true,
      },
    }),
  ],
})
```

## SeedWorkflow Type

The `SeedWorkflow` type defines the structure for template workflows:

```typescript
type SeedWorkflow = {
  slug: string // Unique identifier (stable across renames)
  name: string // Human-readable display name
  description?: string
  triggers: Array<{
    type: string
    parameters?: Record<string, any>
    condition?: string
  }>
  steps: Array<{
    name: string
    type: string
    input?: Record<string, any>
    dependencies?: string[]
    condition?: string
  }>
}
```

**Important**: The `slug` field must be:
- Unique across all workflows
- URL-safe (lowercase, hyphens, no spaces)
- Stable (don't change it once deployed, as it's used for matching)

## Admin UI Behavior

When viewing a read-only workflow in the admin panel:

1. **Warning Banner**: A yellow warning banner appears at the top of the form
2. **Read-Only Fields**: All fields (name, description, triggers, steps) are disabled
3. **List View**: The `slug` and `readOnly` columns show for all workflows
4. **No Delete**: The delete button is hidden or disabled
5. **No Save**: Changes cannot be saved

## Best Practices

### 1. Provide Clear Descriptions

```typescript
{
  name: 'Example: Order Fulfillment',
  description: 'Demonstrates a multi-step order processing workflow with error handling and notifications',
  // ... workflow definition
}
```

### 2. Use Descriptive Step Names

```typescript
steps: [
  {
    name: 'Validate Order Items',
    type: 'validate-data',
    // ...
  },
  {
    name: 'Create Shipment',
    type: 'http-request',
    // ...
  },
]
```

### 3. Add Helpful Comments via Conditions

Use conditions to demonstrate advanced features:

```typescript
{
  name: 'Process High-Value Orders',
  type: 'send-notification',
  condition: '$.trigger.doc.total > 1000',
  // ...
}
```

### 4. Show Dependency Patterns

Demonstrate step dependencies for learning:

```typescript
steps: [
  {
    name: 'Fetch User Data',
    type: 'read-document',
    // ...
  },
  {
    name: 'Send Personalized Email',
    type: 'send-email',
    dependencies: ['Fetch User Data'],
    input: {
      to: '$.steps.fetchUserData.output.email',
      name: '$.steps.fetchUserData.output.name',
    },
  },
]
```

### 5. Organize by Use Case

Group template workflows by common use cases:

```typescript
const emailWorkflows: SeedWorkflow[] = [
  /* email-related templates */
]
const webhookWorkflows: SeedWorkflow[] = [
  /* webhook templates */
]
const dataSync: SeedWorkflow[] = [
  /* data sync templates */
]

seedWorkflows: [...emailWorkflows, ...webhookWorkflows, ...dataSync]
```

## Updating Seeded Workflows

### Automatic Updates

Workflows are automatically updated when you change their definition in code:

```typescript
const exampleWorkflows: SeedWorkflow[] = [
  {
    slug: 'example-welcome-email', // Keep slug stable
    name: 'Example: Welcome Email v2', // Name can change
    description: 'Updated description',
    // Updated triggers and steps...
  },
]
```

On next startup:
1. Plugin detects changes by comparing workflow definition
2. Automatically updates the workflow in the database
3. Logs: `"Updating seeded workflow 'example-welcome-email': Example: Welcome Email v2"`

**What triggers an update:**
- Changes to `name`
- Changes to `description`
- Changes to `triggers` array
- Changes to `steps` array

**What doesn't trigger an update:**
- No change detection for `slug` itself (used as the identifier)
- Workflow metadata (createdAt, updatedAt, etc.)

### Creating New Versions

To create a completely new workflow instead of updating:

```typescript
// Old workflow (will remain)
{
  slug: 'example-welcome-email',
  name: 'Example: Welcome Email',
  // ...
}

// New workflow (separate template)
{
  slug: 'example-welcome-email-v2', // Different slug = new workflow
  name: 'Example: Welcome Email v2',
  // ...
}
```

### Manual Database Operations

If you need to manually remove a seeded workflow:

```bash
# Direct database access required (access control blocks UI/API)
# MongoDB example:
db.workflows.deleteOne({ slug: 'example-welcome-email' })

# Then restart to re-seed
pnpm dev
```

## Duplicating Read-Only Workflows

Users can duplicate read-only workflows to create their own editable versions:

1. Navigate to the read-only workflow
2. Use the "Duplicate" action (if available in your PayloadCMS version)
3. The duplicate will not be read-only

Note: Built-in duplication support depends on PayloadCMS version. You may need to implement custom duplication logic.

## Security Considerations

- Read-only workflows **cannot** be modified through the API
- Access control prevents deletion via admin UI and API
- The `readOnly` field itself is read-only in the admin UI
- Only database-level operations can modify seeded workflows

## Advanced: Conditional Seeding

You can conditionally seed workflows based on environment:

```typescript
const seedWorkflows: SeedWorkflow[] =
  process.env.NODE_ENV === 'development'
    ? [
        /* development examples */
      ]
    : process.env.SEED_TEMPLATES === 'true'
      ? [
          /* production templates */
        ]
      : []

workflowsPlugin({
  seedWorkflows,
  // ...
})
```

## Troubleshooting

### Workflow Not Seeding

Check the server logs for seeding errors:

```
[INFO] Seeding 3 workflows...
[INFO] Seeded workflow: Example: Welcome Email
[INFO] Updating seeded workflow 'example-sync-data': Example: Sync Data
[DEBUG] Workflow 'example-another' is up to date, skipping
[ERROR] Failed to seed workflow 'Example: Invalid': [error details]
```

### Workflow Not Updating

If changes aren't being applied:

1. **Check slug matches**: Ensure the slug in code matches database
2. **Verify JSON comparison**: Minor formatting changes might not trigger updates
3. **Check logs**: Look for "is up to date, skipping" message
4. **Force update**: Delete workflow and restart to re-create

```bash
# Direct database access (MongoDB example)
db.workflows.deleteOne({ slug: 'example-welcome-email' })

# Restart to trigger seeding
pnpm dev
```

### Slug Conflicts

If you get a unique constraint error:

```
Error: E11000 duplicate key error collection: workflows index: slug_1
```

**Cause**: Two workflows with the same slug, or a user-created workflow has the same slug.

**Solution**:
1. Check for duplicate slugs in your `seedWorkflows` array
2. Rename conflicting user workflows or change your seed workflow slug

### TypeScript Errors

Ensure you're importing the type correctly:

```typescript
import type { SeedWorkflow } from '@xtr-dev/payload-automation'
```

## Complete Example

Here's a comprehensive example with multiple workflow templates:

```typescript
import { buildConfig } from 'payload'
import { workflowsPlugin, type SeedWorkflow } from '@xtr-dev/payload-automation/server'
import {
  httpRequestStep,
  sendEmailStep,
  createDocumentStep,
} from '@xtr-dev/payload-automation/server'

const templateWorkflows: SeedWorkflow[] = [
  {
    slug: 'template-user-onboarding',
    name: 'Template: User Onboarding',
    description: 'Complete user onboarding flow with welcome email and initial setup',
    triggers: [
      {
        type: 'collection',
        parameters: {
          collection: 'users',
          hook: 'afterCreate',
        },
      },
    ],
    steps: [
      {
        name: 'Send Welcome Email',
        type: 'send-email',
        input: {
          to: '$.trigger.doc.email',
          subject: 'Welcome!',
          text: 'Thanks for joining, $.trigger.doc.name!',
        },
      },
      {
        name: 'Create User Profile',
        type: 'create-document',
        input: {
          collection: 'profiles',
          data: {
            user: '$.trigger.doc.id',
            preferences: {},
          },
        },
      },
      {
        name: 'Notify Admin',
        type: 'send-email',
        input: {
          to: 'admin@example.com',
          subject: 'New User Registration',
          text: 'New user: $.trigger.doc.email',
        },
        dependencies: ['Send Welcome Email', 'Create User Profile'],
      },
    ],
  },
]

export default buildConfig({
  collections: [
    /* your collections */
  ],
  plugins: [
    workflowsPlugin({
      steps: [httpRequestStep, sendEmailStep, createDocumentStep],
      seedWorkflows: templateWorkflows,
      collectionTriggers: {
        users: true,
      },
    }),
  ],
})
```

## Next Steps

- Review the [Workflow Examples](./WORKFLOW_EXAMPLES.md) for more use cases
- Learn about [Custom Steps](./CUSTOM_STEPS.md) to extend functionality
- Explore [JSONPath Expressions](./JSONPATH.md) for dynamic data access
