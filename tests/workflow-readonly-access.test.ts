import type { Access, Field } from 'payload'

import { describe, expect, it } from 'vitest'

import { createWorkflowCollection } from '../src/collections/Workflow.js'

const invokeAccess = (access: Access | undefined, args: Record<string, unknown>) => {
  if (typeof access !== 'function') {
    throw new Error('expected access control to be a function')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return access(args as any)
}

const checkboxNamed = (fields: Field[], name: string) => {
  const field = fields.find((candidate) => 'name' in candidate && candidate.name === name)
  if (!field || field.type !== 'checkbox') {
    throw new Error(`expected checkbox field named ${name}`)
  }
  return field
}

// A request from a member of the admin user collection (`users`) in a config
// whose users collection has no `access.admin`, which is what isAdminUser in
// src/collections/access.ts accepts.
const adminReq = {
  payload: { config: { admin: { user: 'users' }, collections: [{ slug: 'users' }] } },
  user: { id: 1, collection: 'users' },
}

describe('workflows collection access control', () => {
  const collection = createWorkflowCollection({})

  it('delete ignores request data and always returns the readOnly where clause for admins', async () => {
    expect(
      await invokeAccess(collection.access?.delete, { req: adminReq }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
    expect(
      await invokeAccess(collection.access?.delete, { data: { readOnly: false }, req: adminReq }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
  })

  it('update ignores request data and always returns the readOnly where clause for admins', async () => {
    expect(
      await invokeAccess(collection.access?.update, { req: adminReq }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
    expect(
      await invokeAccess(collection.access?.update, { data: {}, req: adminReq }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
    expect(
      await invokeAccess(collection.access?.update, { data: { readOnly: true }, req: adminReq }),
    ).toEqual({
      readOnly: { not_equals: true },
    })
  })

  it('update and delete refuse requests without an admin user', async () => {
    expect(await invokeAccess(collection.access?.update, { req: { ...adminReq, user: null } })).toBe(false)
    expect(await invokeAccess(collection.access?.delete, { req: { ...adminReq, user: null } })).toBe(false)
  })

  it('readOnly field create and update access always refuse, so REST and access-controlled Local API cannot set the flag', () => {
    const readOnlyField = checkboxNamed(collection.fields, 'readOnly')
    expect(readOnlyField.access?.create?.({} as never)).toBe(false)
    expect(readOnlyField.access?.update?.({} as never)).toBe(false)
  })
})
