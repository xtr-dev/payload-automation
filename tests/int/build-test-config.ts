import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { buildConfig } from 'payload'
import type { SanitizedConfig, TaskConfig } from 'payload'

import { workflowsPlugin } from '../../src/plugin/index.js'
import type { SeedWorkflow } from '../../src/plugin/config-types.js'

export const noopTask: TaskConfig<string> = {
  slug: 'noop-step',
  label: 'No-op',
  handler: () => Promise.resolve({ output: {}, state: 'succeeded' }),
}

export const buildTestConfig = (options: {
  dbFile: string
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
    db: sqliteAdapter({
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
      }),
    ],
    secret: 'test-secret-key',
  })
