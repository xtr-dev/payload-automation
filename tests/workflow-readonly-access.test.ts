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

describe('workflows collection access control', () => {
  const collection = createWorkflowCollection()

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

  it('readOnly field create and update access always refuse, so REST and access-controlled Local API cannot set the flag', () => {
    const readOnlyField = checkboxNamed(collection.fields, 'readOnly')
    expect(readOnlyField.access?.create?.({} as never)).toBe(false)
    expect(readOnlyField.access?.update?.({} as never)).toBe(false)
  })
})
