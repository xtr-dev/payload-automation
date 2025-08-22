import type { TaskConfig } from "payload"

import { updateDocumentHandler } from "./update-document-handler.js"

export const UpdateDocumentStepTask = {
  slug: 'update-document',
  handler: updateDocumentHandler,
  inputSchema: [
    {
      name: 'collection',
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
        description: 'The ID of the document to update'
      },
      required: true
    },
    {
      name: 'data',
      type: 'json',
      admin: {
        description: 'The data to update the document with'
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