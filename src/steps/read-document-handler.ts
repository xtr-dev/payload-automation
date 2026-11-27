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
          docs: [result],
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

    // `docs` is always the list and `doc` always a single document, so an
    // expression never has to know whether the step read by id or by query:
    // for a query, `doc` is the first match (null when nothing matched).
    return {
      output: {
        doc: result.docs[0] ?? null,
        docs: result.docs,
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
