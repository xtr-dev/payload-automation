import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig } from 'payload'
import type { DatabaseAdapterObj, SanitizedConfig, TaskConfig } from 'payload'

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
  /** Extra plugin options, merged over the defaults below. */
  pluginOptions?: Partial<WorkflowsPluginConfig>
  seedWorkflows?: SeedWorkflow[]
}): Promise<SanitizedConfig> =>
  buildConfig({
    collections: [
      {
        slug: 'posts',
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
    secret: 'test-secret-key',
  })
