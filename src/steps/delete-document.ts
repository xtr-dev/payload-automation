import type { TaskConfig } from "payload"

import { deleteDocumentHandler } from "./delete-document-handler.js"

export const DeleteDocumentStepTask = {
  slug: 'delete-document',
  handler: deleteDocumentHandler,
  inputSchema: [
    {
      name: 'collection',
      type: 'text',
      admin: {
        description: 'The collection slug to delete from'
      },
      required: true
    },
    {
      name: 'id',
      type: 'text',
      admin: {
        description: 'The ID of a specific document to delete (leave empty to delete multiple)'
      }
    },
    {
      name: 'where',
      type: 'json',
      admin: {
        description: 'Query conditions to find documents to delete (used when ID is not provided)'
      }
    }
  ],
  outputSchema: [
    {
      name: 'doc',
      type: 'json',
      admin: {
        description: 'The deleted document(s)'
      }
    },
    {
      name: 'deletedCount',
      type: 'number',
      admin: {
        description: 'Number of documents deleted'
      }
    }
  ]
} satisfies TaskConfig<'delete-document'>