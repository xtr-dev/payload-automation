import type { TaskHandler } from "payload"

export const createDocumentHandler: TaskHandler<'create-document'> = async ({ input, req }) => {
  if (!input) {
    throw new Error('No input provided')
  }

  const { collection, data, draft, locale } = input

  if (!collection || typeof collection !== 'string') {
    throw new Error('Collection slug is required')
  }

  if (!data) {
    throw new Error('Document data is required')
  }

  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data

    const result = await req.payload.create({
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
      errorMessage: error instanceof Error ? error.message : 'Failed to create document',
      state: 'failed'
    }
  }
}
