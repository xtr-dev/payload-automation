import type { Access, CollectionConfig, PayloadRequest } from 'payload'

import type { AutomationCollectionSlug, WorkflowsPluginConfig } from '../plugin/config-types.js'

/**
 * True when the request carries a user from the admin user collection
 * (`config.admin.user`) — the same users who can open /admin.
 *
 * A JWT from any other auth-enabled collection (e.g. a public `customers`
 * collection that cannot open /admin) does not pass: automation collection
 * documents execute HTTP requests and document writes with the host
 * application's privileges, so "any logged-in user" is not a safe bar.
 * Payload's config sanitizer guarantees `admin.user` is set at runtime.
 */
export const isAdminUser = ({ req }: { req: PayloadRequest }): boolean =>
  req.user != null && req.user.collection === req.payload.config.admin.user

/**
 * Default access function for the automation collections: the operation is
 * only allowed for admin users.
 */
export const adminUserAccess: Access = (args) => isAdminUser(args)

/**
 * Default update/delete access for the workflows collection: the operation
 * is only allowed for admin users, and never against a stored workflow
 * with `readOnly: true`.
 *
 * The read-only lock is expressed as a `Where` constraint over the stored
 * document. Checking `data.readOnly` inside an access function does not
 * work: on update, `data` is the incoming request payload (a request that
 * simply omits the flag passes), and on delete, `data` is trash metadata.
 */
export const adminUserUnlessReadOnly: Access = ({ req }) => {
  if (!isAdminUser({ req })) {
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
