import fs from 'fs'
import os from 'os'
import path from 'path'

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig, getPayload, type Payload } from 'payload'

import { workflowsPlugin } from '../../src/plugin/index.js'
import type { WorkflowsPluginConfig } from '../../src/plugin/config-types.js'
import { HttpRequestStepTask } from '../../src/steps/index.js'

let instanceCount = 0

// pushDevSchema skips the push when it sees an unchanged schema across
// instances, but every instance here starts from an empty database.
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

/**
 * Creates an isolated Payload instance with the automation plugin installed,
 * an admin user collection (`users`) and a second auth-enabled collection
 * (`customers`) that cannot open /admin.
 *
 * Each instance gets its own SQLite database file under the OS temp
 * directory: libsql shares one in-memory database across all instances in
 * a process, which would leak documents between specs.
 *
 * `pluginOverrides` are merged over the default plugin options, so specs can
 * exercise plugin configurations such as `access` overrides.
 */
export const createTestPayload = async (
  pluginOverrides: Partial<Omit<WorkflowsPluginConfig, 'steps'>> = {},
): Promise<Payload> => {
  instanceCount += 1
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), `payload-automation-test-${instanceCount}-`))

  const pluginOptions: WorkflowsPluginConfig = {
    steps: [HttpRequestStepTask],
    ...pluginOverrides,
  }

  const config = await buildConfig({
    admin: {
      user: 'users',
    },
    collections: [
      {
        slug: 'users',
        auth: true,
        fields: [],
      },
      {
        slug: 'customers',
        auth: true,
        fields: [],
      },
    ],
    db: sqliteAdapter({
      client: {
        url: `file:${path.join(dbDir, 'payload.db')}`,
      },
    }),
    plugins: [workflowsPlugin(pluginOptions)],
    secret: 'e2e-access-control-secret',
  })

  // getPayload caches instances on a module-global map keyed by `key`;
  // without a unique key every call would return the first instance.
  return getPayload({ config, key: `payload-automation-test-${instanceCount}` })
}

/**
 * Shapes a user document the way Payload's REST auth strategy does: the
 * stored document plus the `collection` slug it authenticated against.
 */
export const asUser = (
  user: Record<string, unknown>,
  collection: 'users' | 'customers',
): Record<string, unknown> => ({
  ...user,
  collection,
})
