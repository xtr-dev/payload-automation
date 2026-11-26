import type { Access, CollectionConfig, PayloadRequest, Where } from 'payload'

import type { AutomationCollectionSlug, WorkflowsPluginConfig } from '../plugin/config-types.js'

/**
 * True when the request carries a user who can access /admin.
 *
 * This matches Payload's `canAccessAdmin` behavior: the admin user collection's
 * optional `access.admin` function is evaluated first; only if no such function
 * exists does the fallback check whether the user is from the admin user collection.
 *
 * A JWT from any other auth-enabled collection (e.g. a public `customers`
 * collection that cannot open /admin) does not pass: automation collection
 * documents execute HTTP requests and document writes with the host
 * application's privileges, so "any logged-in user" is not a safe bar.
 * Payload's config sanitizer guarantees `admin.user` is set at runtime.
 */
export const isAdminUser = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  if (req.user == null) {
    return false
  }

  // If not from the admin user collection, they cannot access automation collections
  if (req.user.collection !== req.payload.config.admin.user) {
    return false
  }

  // Get the admin user collection config
  const adminUserCollectionConfig = req.payload.config.collections?.find(
    (c) => c.slug === req.payload.config.admin.user,
  )

  // If the admin user collection defines access.admin, evaluate it
  if (adminUserCollectionConfig?.access?.admin) {
    const result = await adminUserCollectionConfig.access.admin({ req })
    return Boolean(result)
  }

  // Fallback: user is from admin collection and no access.admin function defined
  return true
}

/**
 * Default access function for the automation collections: the operation is
 * only allowed for users who can access /admin.
 */
export const adminUserAccess: Access = (args) => isAdminUser(args)

/**
 * Read-only lock for workflow update/delete: never matches a stored workflow
 * with `readOnly: true`.
 *
 * The lock is expressed as a `Where` constraint over the stored document.
 * Checking `data.readOnly` inside an access function does not work: on
 * update, `data` is the incoming request payload (a request that simply
 * omits the flag passes), and on delete, `data` is trash metadata. Payload
 * combines the constraint with the id lookup on by-id routes, uses it as the
 * filter on bulk routes, and applies `update` access to version restores.
 */
export const readOnlyWorkflowLock: Access = () => ({ readOnly: { not_equals: true } })

type AccessOperation = keyof NonNullable<CollectionConfig['access']>
type CollectionAccess = NonNullable<CollectionConfig['access']>

/**
 * Combines access functions with logical AND, the way Payload would if it
 * evaluated each in turn: any `false` refuses, `true` adds no constraint and
 * `Where` results are joined with `and`. Functions run in order and stop at
 * the first refusal, so a cheap identity check placed first spares the
 * database queries that later functions may run.
 */
export const allOf = (...accessFns: Access[]): Access => async (args) => {
  const constraints: Where[] = []
  for (const accessFn of accessFns) {
    const result = await accessFn(args)
    if (!result) {
      return false
    }
    if (typeof result === 'object') {
      constraints.push(result)
    }
  }
  if (constraints.length === 0) {
    return true
  }
  return constraints.length === 1 ? constraints[0] : { and: constraints }
}

/**
 * Builds a collection's access from the secure defaults, the plugin's
 * `access` option and the collection's integrity locks.
 *
 * - `defaults`: who may perform each operation. A per-operation override from
 *   the plugin's `access` option replaces the default for that operation;
 *   operations without an override keep the default.
 * - `locks`: invariants that hold for everyone, such as "read-only workflows
 *   cannot be changed". They are ANDed with whichever function decides who
 *   may perform the operation, so an override can widen or narrow the
 *   audience but cannot switch a lock off.
 */
export const resolveCollectionAccess = (
  pluginOptions: WorkflowsPluginConfig,
  slug: AutomationCollectionSlug,
  defaults: CollectionAccess,
  locks: Partial<Record<AccessOperation, Access>> = {},
): CollectionAccess => {
  const resolved: Record<string, unknown> = { ...defaults, ...pluginOptions.access?.[slug] }
  for (const [operation, lock] of Object.entries(locks) as [AccessOperation, Access][]) {
    const audience = resolved[operation] as Access | undefined
    resolved[operation] = allOf(audience ?? adminUserAccess, lock)
  }
  return resolved as CollectionAccess
}
