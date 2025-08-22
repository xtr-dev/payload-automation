import type { TaskHandler } from "payload"

export const updateDocumentHandler: TaskHandler<'update-document'> = async ({ input, req }) => {
  if (!input) {
    throw new Error('No input provided')
  }

  const { id, collection, data, draft, locale } = input

  if (!collection || typeof collection !== 'string') {
    throw new Error('Collection slug is required')
  }

  if (!id) {
    throw new Error('Document ID is required')
  }

  if (!data) {
    throw new Error('Update data is required')
  }

  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data

    const result = await req.payload.update({
      id: id.toString(),
      collection,
      data: parsedData,
      draft: draft || false,
      locale: locale || undefined,
      req
    })

    return {
      output: {
        id: result.id,
        doc: result
      },
      state: 'succeeded'
    }
  } catch (error) {
    return {
      errorName: error instanceof Error ? error.message : 'Failed to update document',
      state: 'failed'
    }
  }
}
