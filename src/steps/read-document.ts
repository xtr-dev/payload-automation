import type { TaskConfig } from "payload"

import { readDocumentHandler } from "./read-document-handler.js"

export const ReadDocumentStepTask = {
  slug: 'read-document',
  handler: readDocumentHandler,
  inputSchema: [
    {
      name: 'collection',
      type: 'text',
      admin: {
        description: 'The collection slug to read from'
      },
      required: true
    },
    {
      name: 'id',
      type: 'text',
      admin: {
        description: 'The ID of a specific document to read (leave empty to find multiple)'
      }
    },
    {
      name: 'where',
      type: 'json',
      admin: {
        description: 'Query conditions to find documents (used when ID is not provided)'
      }
    },
    {
      name: 'limit',
      type: 'number',
      admin: {
        description: 'Maximum number of documents to return (default: 10)'
      }
    },
    {
      name: 'sort',
      type: 'text',
      admin: {
        description: 'Field to sort by (prefix with - for descending order)'
      }
    },
    {
      name: 'locale',
      type: 'text',
      admin: {
        description: 'Locale for the document (if localization is enabled)'
      }
    },
    {
      name: 'depth',
      type: 'number',
      admin: {
        description: 'Depth of relationships to populate (0-10)'
      }
    }
  ],
  outputSchema: [
    {
      name: 'doc',
      type: 'json',
      admin: {
        description: 'The document(s) found'
      }
    },
    {
      name: 'totalDocs',
      type: 'number',
      admin: {
        description: 'Total number of documents matching the query'
      }
    }
  ]
} satisfies TaskConfig<'read-document'>