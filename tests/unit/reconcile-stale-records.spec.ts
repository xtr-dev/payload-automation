import { describe, expect, it, vi } from 'vitest'

import { reconcileStaleRecords } from '../../src/plugin/reconcile-stale-records.js'
import type { ReconcileStaleRecordsOptions } from '../../src/plugin/reconcile-stale-records.js'

const makeLogger = (): ReconcileStaleRecordsOptions['logger'] =>
  ({
    warn: vi.fn(),
    debug: vi.fn(),
  }) as unknown as ReconcileStaleRecordsOptions['logger']

describe('reconcileStaleRecords', () => {
  it('leaves an id in place and moves on to the next one when isReferenced throws', async () => {
    const logger = makeLogger()
    const isReferenced = vi.fn((id: string | number) =>
      id === 'throws' ? Promise.reject(new Error('transient find() failure')) : Promise.resolve(false)
    )
    const remove = vi.fn(() => Promise.resolve(undefined))

    await reconcileStaleRecords(['throws', 'unreferenced'], {
      kind: 'trigger',
      isReferenced,
      remove,
      logger,
    })

    // The id whose check failed is left alone rather than deleted...
    expect(remove).not.toHaveBeenCalledWith('throws')
    // ...but the loop still reaches and deletes the id after it.
    expect(remove).toHaveBeenCalledWith('unreferenced')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not determine whether stale trigger throws is referenced by a run')
    )
  })

  it('preserves a referenced id without attempting to remove it', async () => {
    const logger = makeLogger()
    const isReferenced = vi.fn(() => Promise.resolve(true))
    const remove = vi.fn(() => Promise.resolve(undefined))

    await reconcileStaleRecords(['referenced'], {
      kind: 'step',
      isReferenced,
      remove,
      logger,
    })

    expect(remove).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Preserving stale step referenced')
    )
  })

  it('removes an unreferenced id', async () => {
    const logger = makeLogger()
    const isReferenced = vi.fn(() => Promise.resolve(false))
    const remove = vi.fn(() => Promise.resolve(undefined))

    await reconcileStaleRecords(['gone'], {
      kind: 'step',
      isReferenced,
      remove,
      logger,
    })

    expect(remove).toHaveBeenCalledWith('gone')
  })
})
