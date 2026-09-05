import type { Access, CollectionConfig, PayloadRequest } from 'payload'

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
 * Default update/delete access for the workflows collection: the operation
 * is only allowed for users who can access /admin, and never against a stored
 * workflow with `readOnly: true`.
 *
 * The read-only lock is expressed as a `Where` constraint over the stored
 * document. Checking `data.readOnly` inside an access function does not
 * work: on update, `data` is the incoming request payload (a request that
 * simply omits the flag passes), and on delete, `data` is trash metadata.
 */
export const adminUserUnlessReadOnly: Access = async ({ req }) => {
  if (!(await isAdminUser({ req }))) {
    return false
  }
  return { readOnly: { not_equals: true } }
}

/**
 * Merges per-collection access overrides from the plugin's `access` option
 * over the secure defaults. Operations without an override keep the secure
 * default.
 */
export const resolveCollectionAccess = (
  pluginOptions: WorkflowsPluginConfig,
  slug: AutomationCollectionSlug,
  defaults: NonNullable<CollectionConfig['access']>,
): NonNullable<CollectionConfig['access']> => ({
  ...defaults,
  ...pluginOptions.access?.[slug],
})
