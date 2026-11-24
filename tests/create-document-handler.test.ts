import { describe, expect, it, vi } from 'vitest'

import { createDocumentHandler } from '../src/steps/create-document-handler.js'

function makeArgs(input: unknown, create: (args: unknown) => unknown) {
  return {
    input,
    job: {},
    req: { payload: { create } },
  } as unknown as Parameters<typeof createDocumentHandler>[0]
}

describe('createDocumentHandler', () => {
  it('rejects a missing collection slug before touching payload', async () => {
    const create = vi.fn()

    await expect(
      createDocumentHandler(makeArgs({ data: { title: 'Post' } }, create))
    ).rejects.toThrow('Collection slug is required')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates the document in the configured collection and returns its id', async () => {
    const doc = { id: 'doc-1', title: 'Post' }
    const create = vi.fn().mockResolvedValue(doc)

    const result = await createDocumentHandler(
      makeArgs({ collectionSlug: 'posts', data: { title: 'Post' } }, create)
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'posts', data: { title: 'Post' } })
    )
    expect(result).toEqual({
      output: { doc, id: 'doc-1' },
      state: 'succeeded',
    })
  })

  it('parses JSON-string data before writing it', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'doc-2' })

    await createDocumentHandler(
      makeArgs({ collectionSlug: 'posts', data: '{"title":"From string"}' }, create)
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { title: 'From string' } })
    )
  })

  it('turns a payload error into a failed step outcome instead of throwing', async () => {
    const create = vi.fn().mockRejectedValue(new Error('duplicate slug'))

    const result = await createDocumentHandler(
      makeArgs({ collectionSlug: 'posts', data: { title: 'Post' } }, create)
    )

    expect(result).toEqual({
      errorMessage: 'duplicate slug',
      state: 'failed',
    })
  })
})
