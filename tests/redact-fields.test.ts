import type { Payload } from 'payload'

import { describe, expect, it } from 'vitest'

import { getRedactTree, redactDocument, redactTrigger } from '../src/core/redact-fields.js'

/** A stub Payload that only carries the collection and global configs. */
const payloadWith = (config: { collections?: unknown[]; globals?: unknown[] }) =>
  ({ config }) as unknown as Payload

describe('redactDocument', () => {
  it('removes nested fields and the fields of every array row without changing the original', () => {
    const original = {
      keep: 1,
      nested: { keep: 2, secret: 'x' },
      rows: [{ id: 'a', secret: 'y' }, { id: 'b', secret: 'z' }],
      untouched: { deep: true },
    }
    const snapshot = JSON.parse(JSON.stringify(original))

    const redacted = redactDocument(original, { nested: { secret: true }, rows: { secret: true } }) as typeof original

    expect(redacted).toEqual({ keep: 1, nested: { keep: 2 }, rows: [{ id: 'a' }, { id: 'b' }], untouched: { deep: true } })
    expect(original).toEqual(snapshot)
    // Parts with nothing to remove are shared, not copied.
    expect(redacted.untouched).toBe(original.untouched)
  })

  it('passes null, scalars and class instances through', () => {
    const date = new Date()
    expect(redactDocument(null, { a: true })).toBeNull()
    expect(redactDocument('text', { a: true })).toBe('text')
    expect(redactDocument(date, { a: true })).toBe(date)
  })

  it('ends on a document that contains itself', () => {
    const doc: Record<string, unknown> = { secret: 's' }
    doc.self = doc

    const redacted = redactDocument(doc, { secret: true, self: { secret: true } }, new WeakMap()) as Record<string, unknown>

    expect(redacted).not.toHaveProperty('secret')
    expect(redacted.self).toBe(redacted)
  })
})

describe('getRedactTree', () => {
  const fields = [
    { name: 'title', type: 'text' },
    { name: 'token', type: 'text', access: { read: () => false } },
    { name: 'legacy', type: 'text', hidden: true },
    { type: 'row', fields: [{ name: 'inRow', type: 'text', hidden: true }] },
    { name: 'group', type: 'group', fields: [{ name: 'inner', type: 'text', hidden: true }, { name: 'open', type: 'text' }] },
    {
      type: 'tabs',
      tabs: [
        { label: 'Unnamed', fields: [{ name: 'inUnnamedTab', type: 'text', hidden: true }] },
        { name: 'named', fields: [{ name: 'inNamedTab', type: 'text', hidden: true }] },
      ],
    },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        { slug: 'one', fields: [{ name: 'blockSecret', type: 'text', hidden: true }] },
        { slug: 'two', fields: [{ name: 'other', type: 'text', access: { read: () => true } }] },
      ],
    },
  ]

  it('collects hidden fields and fields with read access control, at the path they are stored under', () => {
    const payload = payloadWith({ collections: [{ slug: 'things', fields }] })

    expect(getRedactTree(payload, { hiddenFields: true }, 'collection', 'things')).toEqual({
      group: { inner: true },
      inRow: true,
      inUnnamedTab: true,
      layout: { blockSecret: true, other: true },
      legacy: true,
      named: { inNamedTab: true },
      token: true,
    })
  })

  it('merges listed paths with the hidden fields, and lets a shorter path cover a longer one', () => {
    const payload = payloadWith({ collections: [{ slug: 'things', fields }] })

    expect(
      getRedactTree(payload, { collections: { things: ['title', 'group', 'group.open'] }, hiddenFields: true }, 'collection', 'things')
    ).toMatchObject({ group: true, title: true, token: true })
  })

  it('returns nothing for a slug without paths, and keeps collections and globals apart', () => {
    const payload = payloadWith({ collections: [{ slug: 'things', fields: [] }], globals: [{ slug: 'things', fields: [] }] })
    const options = { globals: { things: ['secret'] } }

    expect(getRedactTree(payload, options, 'collection', 'things')).toBeUndefined()
    expect(getRedactTree(payload, options, 'global', 'things')).toEqual({ secret: true })
  })
})

describe('redactTrigger', () => {
  const payload = payloadWith({ collections: [{ slug: 'orders', fields: [] }] })
  const options = { collections: { orders: ['token'] } }

  it('cleans every place a hook passes the document in', () => {
    const doc = () => ({ id: 1, token: 't' })
    const trigger = {
      args: { data: doc(), id: 1 },
      collection: 'orders',
      data: doc(),
      doc: doc(),
      originalDoc: doc(),
      previousDoc: doc(),
      type: 'collection',
    }

    const redacted = redactTrigger(payload, options, trigger)

    expect(JSON.stringify(redacted)).not.toContain('"token"')
    expect(redacted).toMatchObject({ args: { id: 1 }, collection: 'orders', doc: { id: 1 } })
    expect(trigger.doc.token).toBe('t')
  })

  it('cleans an afterOperation result that is the document or wraps documents', () => {
    const single = redactTrigger(payload, options, { collection: 'orders', result: { id: 1, token: 't' } })
    const many = redactTrigger(payload, options, {
      collection: 'orders',
      result: { docs: [{ id: 1, token: 't' }], totalDocs: 1 },
    })

    expect(single.result).toEqual({ id: 1 })
    expect(many.result).toEqual({ docs: [{ id: 1 }], totalDocs: 1 })
  })

  it('leaves triggers of other collections and triggers without a collection alone', () => {
    const other = { collection: 'posts', doc: { token: 't' } }
    const manual = { data: { token: 't' }, type: 'manual' }

    expect(redactTrigger(payload, options, other)).toBe(other)
    expect(redactTrigger(payload, options, manual)).toBe(manual)
  })
})
