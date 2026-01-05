import type { TaskHandler } from "payload"

export const readDocumentHandler: TaskHandler<'read-document'> = async ({ input, req }) => {
  if (!input) {
    throw new Error('No input provided')
  }

  const { id, collectionSlug, depth, limit, locale, sort, where } = input

  if (!collectionSlug || typeof collectionSlug !== 'string') {
    throw new Error('Collection slug is required')
  }

  try {
    // If ID is provided, find by ID
    if (id) {
      const result = await req.payload.findByID({
        id: id.toString(),
        collection: collectionSlug,
        depth: typeof depth === 'number' ? depth : undefined,
        locale: locale || undefined,
        req
      })

      return {
        output: {
          doc: result,
          totalDocs: 1
        },
        state: 'succeeded'
      }
    }

    // Otherwise, find multiple documents
    const parsedWhere = where ? (typeof where === 'string' ? JSON.parse(where) : where) : {}

    const result = await req.payload.find({
      collection: collectionSlug,
      depth: typeof depth === 'number' ? depth : undefined,
      limit: typeof limit === 'number' ? limit : 10,
      locale: locale || undefined,
      req,
      sort: sort || undefined,
      where: parsedWhere
    })

    return {
      output: {
        doc: result.docs,
        totalDocs: result.totalDocs
      },
      state: 'succeeded'
    }
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : 'Failed to read document(s)',
      state: 'failed'
    }
  }
}
