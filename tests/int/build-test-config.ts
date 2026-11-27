import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig } from 'payload'
import type { Config, DatabaseAdapterObj, SanitizedConfig, TaskConfig } from 'payload'

import { workflowsPlugin } from '../../src/plugin/index.js'
import type { SeedWorkflow, WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

export const noopTask: TaskConfig<string> = {
  slug: 'noop-step',
  label: 'No-op',
  handler: () => Promise.resolve({ output: {}, state: 'succeeded' }),
}

export const buildTestConfig = (options: {
  /** Database adapter to use instead of SQLite on `dbFile`. */
  db?: DatabaseAdapterObj
  dbFile: string
  /** Payload `jobs` config; Payload's defaults apply when omitted. */
  jobs?: Config['jobs']
  /** Extra plugin options, merged over the defaults below. */
  pluginOptions?: Partial<WorkflowsPluginConfig>
  seedWorkflows?: SeedWorkflow[]
}): Promise<SanitizedConfig> =>
  buildConfig({
    // Payload otherwise spawns a detached `payload generate:types` process on
    // every init; with one init per test those pile up and outlive the run.
    typescript: { autoGenerate: false },
    collections: [
      {
        slug: 'posts',
        fields: [],
      },
      // Declared here (rather than left to Payload's default) so that plugin
      // options can register trigger hooks on an auth collection.
      {
        slug: 'users',
        auth: true,
        fields: [],
      },
    ],
    globals: [
      {
        slug: 'settings',
        fields: [],
      },
    ],
    db: options.db ?? sqliteAdapter({
      client: {
        url: `file:${options.dbFile}`,
      },
    }),
    plugins: [
      workflowsPlugin({
        collectionTriggers: { posts: true },
        globalTriggers: { settings: true },
        seedWorkflows: options.seedWorkflows,
        steps: [noopTask],
        ...options.pluginOptions,
      }),
    ],
    ...(options.jobs ? { jobs: options.jobs } : {}),
    secret: 'test-secret-key',
  })
