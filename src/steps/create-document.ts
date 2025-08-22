import type { TaskConfig } from "payload"

import { createDocumentHandler } from "./create-document-handler.js"

export const CreateDocumentStepTask = {
  slug: 'create-document',
  handler: createDocumentHandler,
  inputSchema: [
    {
      name: 'collection',
      type: 'text',
      admin: {
        description: 'The collection slug to create a document in'
      },
      required: true
    },
    {
      name: 'data',
      type: 'json',
      admin: {
        description: 'The document data to create'
      },
      required: true
    },
    {
      name: 'draft',
      type: 'checkbox',
      admin: {
        description: 'Create as draft (if collection has drafts enabled)'
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
        description: 'The created document'
      }
    },
    {
      name: 'id',
      type: 'text',
      admin: {
        description: 'The ID of the created document'
      }
    }
  ]
} satisfies TaskConfig<'create-document'>