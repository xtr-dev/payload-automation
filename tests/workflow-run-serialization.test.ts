import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'

import { WorkflowExecutor } from '../src/core/workflow-executor.js'
import type { WorkflowsPluginConfig } from '../src/plugin/config-types.js'

const email = 'editor@example.com'
// A fresh object per use: safeSerialize replaces an object it has already
// visited with '[Circular Reference]', which would hide what is being tested.
const user = () => ({ id: 7, collection: 'users', email, name: 'Editor' })

/** Builds an executor around a stub Payload that only carries the plugin config. */
const executorWith = (pluginConfig: Partial<WorkflowsPluginConfig>) => {
  const payload = {
    config: { custom: { pluginConfigs: { '@xtr-dev/payload-automation': pluginConfig } } },
  } as unknown as Payload
  const executor = new WorkflowExecutor(payload, {} as Payload['logger'])
  // safeSerialize is what every stored snapshot (triggerData, context, inputs) goes through.
  return (value: unknown) =>
    (executor as unknown as { safeSerialize: (v: unknown) => unknown }).safeSerialize(value)
}

// Hook argument shapes as Payload passes them, plus the trigger fields the plugin adds.
const afterLoginTrigger = () => ({
  type: 'collection',
  collection: 'users',
  req: { method: 'POST', user: user(), payload: {} },
  token: 'session-token-afterLogin',
  user: user(),
})
const afterMeTrigger = () => ({
  type: 'collection',
  collection: 'users',
  req: { user: user() },
  response: { user: user(), token: 'session-token-afterMe', exp: 123 },
})
const afterOperationTrigger = () => ({
  type: 'collection',
  collection: 'users',
  operation: 'login',
  req: { user: user() },
  result: { user: user(), token: 'session-token-afterOperation', exp: 123 },
})
const afterRefreshTrigger = () => ({
  type: 'collection',
  collection: 'users',
  req: { user: user() },
  token: 'session-token-afterRefresh',
  exp: 123,
})

describe('stored workflow run snapshots', () => {
  it('never store session tokens, even without stripUserData', () => {
    const serialize = executorWith({})
    for (const trigger of [afterLoginTrigger(), afterMeTrigger(), afterOperationTrigger(), afterRefreshTrigger()]) {
      const stored = JSON.stringify([serialize(trigger), serialize({ steps: {}, trigger })])
      expect(stored).not.toContain('session-token')
    }
  })

  it('keep user objects by default', () => {
    const stored = executorWith({})(afterMeTrigger()) as {
      req: { user?: unknown }
      response: { user?: unknown }
    }
    expect(stored.req.user).toMatchObject({ email })
    expect(stored.response.user).toMatchObject({ email })
  })

  it('with stripUserData, drop req.user, trigger.user, response.user and result.user', () => {
    const serialize = executorWith({ stripUserData: true })
    for (const trigger of [afterLoginTrigger(), afterMeTrigger(), afterOperationTrigger()]) {
      const stored = JSON.stringify([serialize(trigger), serialize({ steps: {}, trigger })])
      expect(stored).not.toContain(email)
    }
    const kept = serialize(afterMeTrigger()) as { response: { exp?: number } }
    expect(kept.response.exp).toBe(123)
  })

  it('with stripUserData, keep user fields that belong to the document itself', () => {
    const serialize = executorWith({ stripUserData: true })
    const stored = serialize({
      doc: { id: 1, user: { id: 3, email: 'author@example.com' } },
      previousDoc: { id: 1, user: 3 },
      req: { user: user() },
    }) as { doc: { user?: unknown }; previousDoc: { user?: unknown }; req: { user?: unknown } }
    expect(stored.doc.user).toMatchObject({ email: 'author@example.com' })
    expect(stored.previousDoc.user).toBe(3)
    expect(stored.req.user).toBeUndefined()
  })
})
