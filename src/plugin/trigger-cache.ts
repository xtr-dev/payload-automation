import type { CollectionConfig, Payload } from 'payload'

import { getSharedState } from '../core/shared-state.js'

/**
 * The fields of an `automation-triggers` document that the collection/global
 * hook handlers need to decide whether a hook event fired a trigger.
 */
export interface HookTriggerDoc {
  collectionSlug?: null | string
  condition?: null | string
  globalSlug?: null | string
  hook?: null | string
  id: number | string
  name?: null | string
  type: string
}

interface CacheEntry {
  expiresAt: number
  triggers: Promise<HookTriggerDoc[]>
}

/**
 * Default time a loaded trigger list stays valid. Edits made through this
 * process clear the cache right away (see `clearHookTriggerCache`); the TTL
 * only bounds how long edits made by *another* process (a second server, a
 * serverless instance, a direct database write) can go unnoticed.
 */
export const DEFAULT_TRIGGER_CACHE_TTL_MS = 60_000

// Keyed by Payload instance so separate instances in one process (tests,
// multi-tenant setups) never share trigger lists. Shared between all copies
// of the plugin in the process (see shared-state.ts), so that a copy other
// than the one whose hooks filled the cache can still clear it.
const cache = getSharedState('hookTriggerCache', () => new WeakMap<Payload, CacheEntry>())

const loadHookTriggers = async (payload: Payload): Promise<HookTriggerDoc[]> => {
  const { docs } = await payload.find({
    collection: 'automation-triggers',
    depth: 0,
    pagination: false,
    where: {
      type: { in: ['collection-hook', 'global-hook'] },
    },
  })
  return docs as unknown as HookTriggerDoc[]
}

/**
 * Returns every collection-hook and global-hook trigger, loading them with a
 * single query and reusing the result until it expires or is cleared.
 *
 * Collection hooks such as `afterRead` fire on every read of a document, so
 * querying `automation-triggers` from each hook call would add a database
 * round trip to every read even when no trigger listens to that hook.
 *
 * @param ttlMs How long a loaded list is reused. `0` disables caching and
 *   queries on every call, which was the behaviour before the cache existed.
 */
export const getHookTriggers = (payload: Payload, ttlMs: number): Promise<HookTriggerDoc[]> => {
  if (ttlMs <= 0) {
    return loadHookTriggers(payload)
  }

  const now = Date.now()
  const existing = cache.get(payload)
  if (existing && existing.expiresAt > now) {
    return existing.triggers
  }

  const triggers = loadHookTriggers(payload)
  const entry: CacheEntry = { expiresAt: now + ttlMs, triggers }
  cache.set(payload, entry)

  // A failed load must not be served from the cache for the rest of the TTL.
  triggers.catch(() => {
    if (cache.get(payload) === entry) {
      cache.delete(payload)
    }
  })

  return triggers
}

/**
 * Drops the cached trigger list so the next hook call reloads it. Registered
 * as an afterChange/afterDelete hook on `automation-triggers`.
 */
export const clearHookTriggerCache = (payload: Payload): void => {
  cache.delete(payload)
}

/**
 * Filters a loaded trigger list down to the triggers that listen to one
 * collection or global hook. Mirrors the `where` query the hook handler used
 * before the cache existed: type, target slug and hook name must all match.
 */
export const selectMatchingTriggers = (
  triggers: HookTriggerDoc[],
  type: 'collection' | 'global',
  slug: string,
  hookType: string
): HookTriggerDoc[] =>
  triggers.filter((trigger) =>
    type === 'collection'
      ? trigger.type === 'collection-hook' && trigger.collectionSlug === slug && trigger.hook === hookType
      : trigger.type === 'global-hook' && trigger.globalSlug === slug && trigger.hook === hookType
  )

/**
 * Adds afterChange/afterDelete hooks to the `automation-triggers` collection
 * that clear the cached trigger list, so a trigger created, edited or deleted
 * through this Payload instance takes effect on the next hook call instead of
 * after the TTL.
 */
export const withTriggerCacheInvalidation = (collection: CollectionConfig): CollectionConfig => {
  const clear = ({ req }: { req: { payload: Payload } }) => {
    clearHookTriggerCache(req.payload)
  }
  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      afterChange: [...(collection.hooks?.afterChange ?? []), clear],
      afterDelete: [...(collection.hooks?.afterDelete ?? []), clear],
    },
  }
}
