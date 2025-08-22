/**
 * Example: Manual Trigger Workflow
 * 
 * This example shows how to create a workflow that can be triggered
 * manually from the PayloadCMS admin interface using a custom button.
 */

import type { Payload } from 'payload'

/**
 * Create a workflow with manual trigger
 */
export async function createManualTriggerWorkflow(payload: Payload) {
  const workflow = await payload.create({
    collection: 'workflows',
    data: {
      name: 'Manual Data Processing',
      description: 'A workflow that can be triggered manually from the admin UI',
      triggers: [
        {
          type: 'manual-trigger'  // This enables the trigger button in the admin
        }
      ],
      steps: [
        {
          name: 'fetch-data',
          type: 'http-request-step',
          input: {
            url: 'https://api.example.com/data',
            method: 'GET'
          }
        },
        {
          name: 'process-data',
          type: 'create-document',
          input: {
            collection: 'auditLog',
            data: {
              message: 'Manual workflow executed',
              triggeredAt: '$.trigger.data.timestamp'
            }
          },
          dependencies: ['fetch-data']  // This step depends on fetch-data
        }
      ]
    }
  })

  console.log('Created workflow:', workflow.id)
  return workflow
}

/**
 * Trigger a workflow programmatically using the custom trigger
 */
export async function triggerWorkflowProgrammatically(payload: Payload) {
  // Import the trigger functions from the plugin
  const { triggerCustomWorkflow, triggerWorkflowById } = await import('@xtr-dev/payload-automation')
  
  // Option 1: Trigger all workflows with a specific trigger slug
  const results = await triggerCustomWorkflow(payload, {
    slug: 'manual-trigger',
    data: {
      source: 'api',
      timestamp: new Date().toISOString(),
      user: 'system'
    }
  })
  
  console.log('Triggered workflows:', results)
  
  // Option 2: Trigger a specific workflow by ID
  const workflowId = 'your-workflow-id'
  const result = await triggerWorkflowById(
    payload,
    workflowId,
    'manual-trigger',
    {
      source: 'api',
      timestamp: new Date().toISOString()
    }
  )
  
  console.log('Triggered workflow:', result)
}

/**
 * Example usage in your application
 */
export async function setupManualTriggerExample(payload: Payload) {
  // Create the workflow
  const workflow = await createManualTriggerWorkflow(payload)
  
  // The workflow is now available in the admin UI with a trigger button
  console.log('Workflow created! You can now:')
  console.log('1. Go to the admin UI and navigate to the Workflows collection')
  console.log('2. Open the workflow:', workflow.name)
  console.log('3. Click the "Trigger Workflow" button to execute it manually')
  
  // You can also trigger it programmatically
  await triggerWorkflowProgrammatically(payload)
}

/**
 * Notes:
 * 
 * 1. The manual trigger button appears automatically in the workflow admin UI
 *    when a workflow has a trigger with type 'manual-trigger'
 * 
 * 2. You can have multiple triggers on the same workflow, including manual triggers
 * 
 * 3. The trigger passes data to the workflow execution context, accessible via:
 *    - $.trigger.data - The custom data passed when triggering
 *    - $.trigger.type - The trigger type ('manual-trigger')
 *    - $.trigger.triggeredAt - Timestamp of when the trigger was activated
 * 
 * 4. Manual triggers are useful for:
 *    - Administrative tasks
 *    - Data migration workflows
 *    - Testing and debugging
 *    - On-demand processing
 */