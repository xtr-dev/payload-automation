import { buildConfig } from 'payload'
import { workflowsPlugin, triggerCustomWorkflow } from '@xtr-dev/payload-automation'
import type { Field } from 'payload'

// Example: Data import trigger with custom fields
const dataImportFields: Field[] = [
  {
    name: 'sourceUrl',
    type: 'text',
    required: true,
    admin: {
      description: 'URL of the data source to import from'
    }
  },
  {
    name: 'format',
    type: 'select',
    options: ['json', 'csv', 'xml'],
    required: true,
    admin: {
      description: 'Format of the data to import'
    }
  },
  {
    name: 'mapping',
    type: 'json',
    admin: {
      description: 'Field mapping configuration'
    }
  }
]

// Example: Manual review trigger with approval fields
const manualReviewFields: Field[] = [
  {
    name: 'reviewerId',
    type: 'text',
    required: true,
    admin: {
      description: 'ID of the reviewer'
    }
  },
  {
    name: 'reviewNotes',
    type: 'textarea',
    admin: {
      description: 'Notes from the review'
    }
  },
  {
    name: 'approved',
    type: 'checkbox',
    defaultValue: false,
    admin: {
      description: 'Whether the item was approved'
    }
  }
]

export default buildConfig({
  // ... other config
  
  plugins: [
    workflowsPlugin({
      collectionTriggers: {
        posts: true,  // Enable all CRUD triggers for posts
        products: {   // Selective triggers for products
          create: true,
          update: true
        }
      },
      
      // Define custom triggers that will appear in the workflow UI
      triggers: [
        {
          slug: 'data-import',
          inputs: dataImportFields
        },
        {
          slug: 'manual-review',
          inputs: manualReviewFields
        },
        {
          slug: 'scheduled-report',
          inputs: [
            {
              name: 'reportType',
              type: 'select',
              options: ['daily', 'weekly', 'monthly'],
              required: true
            }
          ]
        }
      ],
      
      steps: [
        // ... your workflow steps
      ]
    })
  ],
  
  onInit: async (payload) => {
    // Example 1: Trigger workflow from external data source
    // This could be called from a webhook, scheduled job, or any other event
    const handleDataImport = async (sourceUrl: string, format: string) => {
      const results = await triggerCustomWorkflow(payload, {
        slug: 'data-import',
        data: {
          sourceUrl,
          format,
          mapping: {
            title: 'name',
            description: 'summary'
          },
          importedAt: new Date().toISOString()
        }
      })
      
      console.log('Data import workflows triggered:', results)
    }
    
    // Example 2: Trigger workflow after custom business logic
    const handleDocumentReview = async (documentId: string, reviewerId: string, approved: boolean) => {
      // Perform your custom review logic here
      const reviewData = {
        documentId,
        reviewerId,
        reviewNotes: approved ? 'Document meets all requirements' : 'Needs revision',
        approved,
        reviewedAt: new Date().toISOString()
      }
      
      // Trigger workflows that listen for manual review
      const results = await triggerCustomWorkflow(payload, {
        slug: 'manual-review',
        data: reviewData,
        user: {
          id: reviewerId,
          email: 'reviewer@example.com'
        }
      })
      
      return results
    }
    
    // Example 3: Integrate with external services
    // You could set up listeners for external events
    if (process.env.ENABLE_EXTERNAL_SYNC) {
      // Listen to external service events (example with a hypothetical event emitter)
      // externalService.on('data-ready', async (event) => {
      //   await triggerCustomWorkflow(payload, {
      //     slug: 'data-import',
      //     data: event.data
      //   })
      // })
    }
    
    // Example 4: Create scheduled reports using node-cron or similar
    // This shows how you might trigger a custom workflow on a schedule
    // without using the built-in cron trigger
    const scheduleReports = async () => {
      // This could be called by a cron job or scheduled task
      await triggerCustomWorkflow(payload, {
        slug: 'scheduled-report',
        data: {
          reportType: 'daily',
          generatedAt: new Date().toISOString(),
          metrics: {
            totalUsers: 1000,
            activeUsers: 750,
            newSignups: 25
          }
        }
      })
    }
    
    // Example 5: Hook into collection operations for complex logic
    const postsCollection = payload.collections.posts
    if (postsCollection) {
      postsCollection.config.hooks = postsCollection.config.hooks || {}
      postsCollection.config.hooks.afterChange = postsCollection.config.hooks.afterChange || []
      
      postsCollection.config.hooks.afterChange.push(async ({ doc, operation, req }) => {
        // Custom logic to determine if we should trigger a workflow
        if (operation === 'create' && doc.status === 'published') {
          // Trigger a custom workflow for newly published posts
          await triggerCustomWorkflow(payload, {
            slug: 'manual-review',
            data: {
              documentId: doc.id,
              documentType: 'post',
              reviewerId: 'auto-review',
              reviewNotes: 'Automatically queued for review',
              approved: false
            },
            req // Pass the request context
          })
        }
      })
    }
    
    // Make functions available globally for testing/debugging
    ;(global as any).handleDataImport = handleDataImport
    ;(global as any).handleDocumentReview = handleDocumentReview
    ;(global as any).scheduleReports = scheduleReports
  }
})

// Example workflow configuration that would use these custom triggers:
/*
{
  name: "Process Data Import",
  triggers: [{
    type: "data-import",
    sourceUrl: "https://api.example.com/data",
    format: "json",
    mapping: { ... }
  }],
  steps: [
    {
      step: "http-request",
      name: "fetch-data",
      input: {
        url: "$.trigger.data.sourceUrl",
        method: "GET"
      }
    },
    {
      step: "create-document",
      name: "import-records",
      input: {
        collection: "imported-data",
        data: "$.steps.fetch-data.output.body"
      },
      dependencies: ["fetch-data"]
    }
  ]
}

{
  name: "Review Approval Workflow",
  triggers: [{
    type: "manual-review",
    reviewerId: "",
    reviewNotes: "",
    approved: false
  }],
  steps: [
    {
      step: "update-document",
      name: "update-status",
      input: {
        collection: "documents",
        id: "$.trigger.data.documentId",
        data: {
          status: "$.trigger.data.approved ? 'approved' : 'rejected'",
          reviewedBy: "$.trigger.data.reviewerId",
          reviewedAt: "$.trigger.data.reviewedAt"
        }
      }
    },
    {
      step: "send-email",
      name: "notify-author",
      input: {
        to: "author@example.com",
        subject: "Document Review Complete",
        text: "Your document has been $.trigger.data.approved ? 'approved' : 'rejected'"
      },
      dependencies: ["update-status"]
    }
  ]
}
*/