import type { Access } from 'payload'

import { describe, expect, it } from 'vitest'

import { createWorkflowCollection } from '../../collections/Workflow.js'

// Regression test for the bug fixed in 7528b76: delete/update access checked
// `data?.readOnly`, where `data` is the incoming request body. `delete` never
// receives a `data` at all (so read-only workflows were always deletable),
// and `update` could bypass the guard by omitting `readOnly` from the body.
// The fix returns a `Where` clause instead, which Payload's deleteByID/
// updateByID combine with the id lookup so the *stored* document's readOnly
// flag is what gets checked, regardless of what the request sends.
describe('workflows collection access control', () => {
  const collection = createWorkflowCollection()

  const invokeAccess = (access: Access | undefined, args: Record<string, unknown>) => {
    if (typeof access !== 'function') {
      throw new Error('expected access control to be a function')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return access(args as any)
  }

  it('delete ignores request data and always returns the readOnly where clause', () => {
    expect(invokeAccess(collection.access?.delete, {})).toEqual({
      readOnly: { not_equals: true },
    })
    expect(invokeAccess(collection.access?.delete, { data: { readOnly: false } })).toEqual({
      readOnly: { not_equals: true },
    })
  })

  it('update ignores request data and always returns the readOnly where clause', () => {
    expect(invokeAccess(collection.access?.update, {})).toEqual({
      readOnly: { not_equals: true },
    })
    expect(invokeAccess(collection.access?.update, { data: {} })).toEqual({
      readOnly: { not_equals: true },
    })
    expect(
      invokeAccess(collection.access?.update, { data: { readOnly: true } }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
  })

  it('readOnly field denies update so REST cannot flip the stored lock flag', () => {
    const field = collection.fields.find(
      (candidate) => 'name' in candidate && candidate.name === 'readOnly',
    )
    if (!field || !('access' in field)) {
      throw new Error('expected a named readOnly field with access control')
    }

    const updateAccess = field.access?.update
    if (typeof updateAccess !== 'function') {
      throw new Error('expected readOnly.access.update to be a function')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(updateAccess({} as any)).toBe(false)
    // Create stays unrestricted so seeding can set the flag on insert.
    expect(field.access?.create).toBeUndefined()
  })
})
