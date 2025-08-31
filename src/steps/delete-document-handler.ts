import type { TaskHandler } from "payload"

export const deleteDocumentHandler: TaskHandler<'delete-document'> = async ({ input, req }) => {
  if (!input) {
    throw new Error('No input provided')
  }

  const { id, collectionSlug, where } = input

  if (!collectionSlug || typeof collectionSlug !== 'string') {
    throw new Error('Collection slug is required')
  }

  try {
    // If ID is provided, delete by ID
    if (id) {
      const result = await req.payload.delete({
        id: id.toString(),
        collection: collectionSlug,
        req
      })

      return {
        output: {
          deletedCount: 1,
          doc: result
        },
        state: 'succeeded'
      }
    }

    // Otherwise, delete multiple documents
    if (!where) {
      throw new Error('Either ID or where conditions must be provided')
    }

    const parsedWhere = typeof where === 'string' ? JSON.parse(where) : where

    // First find the documents to delete
    const toDelete = await req.payload.find({
      collection: collectionSlug,
      limit: 1000, // Set a reasonable limit
      req,
      where: parsedWhere
    })

    // Delete each document
    const deleted = []
    for (const doc of toDelete.docs) {
      const result = await req.payload.delete({
        id: doc.id,
        collection: collectionSlug,
        req
      })
      deleted.push(result)
    }

    return {
      output: {
        deletedCount: deleted.length,
        doc: deleted
      },
      state: 'succeeded'
    }
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : 'Failed to delete document(s)',
      state: 'failed'
    }
  }
}
