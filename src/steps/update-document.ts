import type { TaskConfig } from "payload"

import { updateDocumentHandler } from "./update-document-handler.js"

export const UpdateDocumentStepTask = {
  slug: 'update-document',
  handler: updateDocumentHandler,
  inputSchema: [
    {
      name: 'collectionSlug',
      type: 'text',
      admin: {
        description: 'The collection slug to update a document in'
      },
      required: true
    },
    {
      name: 'id',
      type: 'text',
      admin: {
        description: 'The ID of the document to update. Use JSONPath to reference IDs (e.g., "$.trigger.doc.id" or "$.steps.previousStep.output.id")'
      },
      required: true
    },
    {
      name: 'data',
      type: 'json',
      admin: {
        description: 'The data to update the document with. Use JSONPath to reference values (e.g., {"status": "$.trigger.doc.status", "updatedBy": "$.trigger.user.id"})'
      },
      required: true
    },
    {
      name: 'draft',
      type: 'checkbox',
      admin: {
        description: 'Update as draft (if collection has drafts enabled)'
      }
    },
    {
      name: 'locale',
      type: 'text',
      admin: {
        description: 'Locale for the document (if localization is enabled)'
      }
    }
  ],
  outputSchema: [
    {
      name: 'doc',
      type: 'json',
      admin: {
        description: 'The updated document'
      }
    },
    {
      name: 'id',
      type: 'text',
      admin: {
        description: 'The ID of the updated document'
      }
    }
  ]
} satisfies TaskConfig<'update-document'>