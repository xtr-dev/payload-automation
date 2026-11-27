import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allGlobalHooks } from '../../src/triggers/hook-options.js'
import { buildTestConfig } from './build-test-config.js'

const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Resolves to the field-level validation messages of a rejected save, so a
 * test can assert on the text an admin user or API client is shown.
 */
const validationMessages = async (save: Promise<unknown>): Promise<string[]> => {
  try {
    await save
  } catch (error) {
    const fieldErrors = (error as { data?: { errors?: { message: string; path: string }[] } }).data?.errors
    if (!fieldErrors) {
      throw error
    }
    return fieldErrors.map((fieldError) => `${fieldError.path}: ${fieldError.message}`)
  }
  throw new Error('Expected the save to be rejected')
}

describe('automation-triggers validates the hook against the trigger type', () => {
  const dbFile = path.join(os.tmpdir(), `payload-automation-hook-validation-${uniqueId()}.db`)
  let payload: Payload

  beforeAll(async () => {
    // getPayload() caches instances process-wide by `key`, so use a unique one.
    payload = await getPayload({ config: buildTestConfig({ dbFile }), key: uniqueId() })
  })

  afterAll(async () => {
    await payload.destroy()
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${dbFile}${suffix}`, { force: true })
    }
  })

  it('refuses a global hook trigger with a hook that only collections have', async () => {
    const messages = await validationMessages(
      payload.create({
        collection: 'automation-triggers',
        data: { name: 'settings afterDelete', type: 'global-hook', globalSlug: 'settings', hook: 'afterDelete' },
      })
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('hook: "afterDelete" is a collection hook that globals do not have')
    // The message lists what can be chosen instead.
    expect(messages[0]).toContain(allGlobalHooks.join(', '))
    expect((await payload.count({ collection: 'automation-triggers' })).totalDocs).toBe(0)
  })

  it('accepts every global hook on a global hook trigger', async () => {
    for (const hook of allGlobalHooks) {
      const trigger = await payload.create({
        collection: 'automation-triggers',
        data: { name: `settings ${hook}`, type: 'global-hook', globalSlug: 'settings', hook },
      })
      expect(trigger.hook).toBe(hook)
    }
  })

  it('accepts a collection-only hook on a collection hook trigger', async () => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts afterDelete', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterDelete' },
    })
    expect(trigger.hook).toBe('afterDelete')
  })

  it('refuses a hook name that is not a Payload hook', async () => {
    const messages = await validationMessages(
      payload.create({
        collection: 'automation-triggers',
        data: { name: 'posts typo', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterChnage' },
      })
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/^hook: /)
  })

  it('refuses changing only the hook of a global hook trigger to a collection-only hook', async () => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'settings update hook', type: 'global-hook', globalSlug: 'settings', hook: 'afterChange' },
    })

    const messages = await validationMessages(
      payload.update({ collection: 'automation-triggers', id: trigger.id, data: { hook: 'afterLogin' } })
    )
    expect(messages[0]).toContain('"afterLogin" is a collection hook that globals do not have')
    expect((await payload.findByID({ collection: 'automation-triggers', id: trigger.id })).hook).toBe('afterChange')
  })

  it('refuses changing only the type to global hook while the stored hook is collection-only', async () => {
    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: { name: 'posts to settings', type: 'collection-hook', collectionSlug: 'posts', hook: 'afterDelete' },
    })

    const messages = await validationMessages(
      payload.update({
        collection: 'automation-triggers',
        id: trigger.id,
        data: { type: 'global-hook', globalSlug: 'settings' },
      })
    )
    expect(messages[0]).toContain('"afterDelete" is a collection hook that globals do not have')
    expect((await payload.findByID({ collection: 'automation-triggers', id: trigger.id })).type).toBe('collection-hook')
  })
})
