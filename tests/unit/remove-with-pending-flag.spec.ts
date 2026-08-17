import { describe, expect, it, vi } from 'vitest'

import { removeWithPendingFlag } from '../../src/plugin/remove-with-pending-flag.js'

describe('removeWithPendingFlag', () => {
  it('deletes the record and never touches the flag when delete succeeds', async () => {
    const del = vi.fn(() => Promise.resolve(undefined))
    const update = vi.fn(() => Promise.resolve(undefined))
    const remove = removeWithPendingFlag({
      payload: { delete: del, update } as any,
      collection: 'automation-triggers',
    })

    await remove('ok')

    expect(del).toHaveBeenCalledWith({ collection: 'automation-triggers', id: 'ok', overrideAccess: true })
    expect(update).not.toHaveBeenCalled()
  })

  it('flags pendingDeletion:true and rethrows when delete fails', async () => {
    const deleteError = new Error('write conflict')
    const del = vi.fn(() => Promise.reject(deleteError))
    const update = vi.fn(() => Promise.resolve(undefined))
    const remove = removeWithPendingFlag({
      payload: { delete: del, update } as any,
      collection: 'automation-steps',
    })

    await expect(remove('stuck')).rejects.toThrow(deleteError)

    expect(update).toHaveBeenCalledWith({
      collection: 'automation-steps',
      id: 'stuck',
      data: { pendingDeletion: true },
      overrideAccess: true,
    })
  })

  it('still rethrows the original delete error when the flagging update itself fails', async () => {
    const deleteError = new Error('write conflict')
    const del = vi.fn(() => Promise.reject(deleteError))
    const update = vi.fn(() => Promise.reject(new Error('db unavailable')))
    const remove = removeWithPendingFlag({
      payload: { delete: del, update } as any,
      collection: 'automation-triggers',
    })

    await expect(remove('stuck')).rejects.toThrow(deleteError)
  })
})
