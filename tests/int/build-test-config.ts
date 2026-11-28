import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { createHash } from 'crypto'
import { buildConfig } from 'payload'
import type { Config, DatabaseAdapterObj, Payload, SanitizedConfig, TaskConfig } from 'payload'

import { workflowsPlugin } from '../../src/plugin/index.js'
import type { SeedWorkflow, WorkflowsPluginConfig } from '../../src/plugin/config-types.js'

export const noopTask: TaskConfig<string> = {
  slug: 'noop-step',
  label: 'No-op',
  handler: () => Promise.resolve({ output: {}, state: 'succeeded' }),
}

/**
 * The database a test runs on when it does not pass its own `db`.
 *
 * SQLite on the test's `dbFile` by default. Setting `TEST_DATABASE` runs the
 * same tests on another adapter, against the server at `TEST_DATABASE_URL`:
 *
 * - `postgres`: `TEST_DATABASE_URL` is a connection string to an existing
 *   database. Every config gets its own Postgres schema, so tests start empty
 *   like they do with a fresh SQLite file.
 * - `mongodb`: `TEST_DATABASE_URL` is a server URL; every config gets its own
 *   database, whatever database the URL names. Transactions are used when the server
 *   supports them (a replica set), unless `TEST_MONGODB_TRANSACTIONS=false`.
 *
 * The name of the schema or database is derived from `dbFile`, which tests
 * already make unique per Payload instance. Unlike SQLite and MongoDB,
 * Postgres wraps every Local API write in a transaction by default, which is
 * the behaviour the trigger hooks have to cope with.
 */
/** `url` with its database name replaced by `name`; options in the query string are kept. */
const withDatabaseName = (url: string, name: string): string => {
  const target = new URL(url)
  target.pathname = `/${name}`
  return target.toString()
}

const testDatabase = (dbFile: string): DatabaseAdapterObj => {
  const kind = process.env.TEST_DATABASE
  const url = process.env.TEST_DATABASE_URL
  if (!kind || kind === 'sqlite') {
    return sqliteAdapter({
      client: {
        url: `file:${dbFile}`,
      },
    })
  }
  if (!url) {
    throw new Error(`TEST_DATABASE=${kind} needs TEST_DATABASE_URL`)
  }
  // Short and made of safe characters, so it is valid as a Postgres schema
  // name (63 bytes at most) and as a MongoDB database name.
  const name = `t_${createHash('sha1').update(dbFile).digest('hex').slice(0, 24)}`
  if (kind === 'postgres') {
    return postgresAdapter({ pool: { connectionString: url }, schemaName: name })
  }
  if (kind === 'mongodb') {
    return mongooseAdapter({
      ...(process.env.TEST_MONGODB_TRANSACTIONS === 'false' ? { transactionOptions: false as const } : {}),
      url: withDatabaseName(url, name),
    })
  }
  throw new Error(`Unknown TEST_DATABASE "${kind}"; use sqlite, postgres or mongodb`)
}

/**
 * Waits until a freshly initialised MongoDB database has all its collections
 * and indexes. Mongoose creates them in the background after connecting, and
 * MongoDB aborts a transaction that writes to a collection while it is being
 * created or indexed ("catalog changes; please retry"). Does nothing on other
 * adapters, whose schema is complete when `getPayload` resolves.
 */
export const waitForDatabaseSchema = async (payload: Payload): Promise<void> => {
  const db = payload.db as unknown as {
    connection?: { models?: Record<string, { createCollection: () => Promise<unknown>; init: () => Promise<unknown> }> }
    name?: string
  }
  if (db.name !== 'mongoose') {
    return
  }
  for (const model of Object.values(db.connection?.models ?? {})) {
    await model.createCollection()
    await model.init()
  }
}

export const buildTestConfig = (options: {
  /** Database adapter to use instead of the default one (see `testDatabase`). */
  db?: DatabaseAdapterObj
  dbFile: string
  /** Plugins applied after the workflows plugin, e.g. to add host hooks to its collections. */
  extraPlugins?: Config['plugins']
  /** Payload `jobs` config; Payload's defaults apply when omitted. */
  jobs?: Config['jobs']
  /** Plugins applied before the workflows plugin, e.g. to add a collection it registers trigger hooks on. */
  prePlugins?: Config['plugins']
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
    db: options.db ?? testDatabase(options.dbFile),
    plugins: [
      ...(options.prePlugins ?? []),
      workflowsPlugin({
        collectionTriggers: { posts: true },
        globalTriggers: { settings: true },
        seedWorkflows: options.seedWorkflows,
        steps: [noopTask],
        ...options.pluginOptions,
      }),
      ...(options.extraPlugins ?? []),
    ],
    ...(options.jobs ? { jobs: options.jobs } : {}),
    // Runs before the plugin seeds workflows (plugins call the incoming
    // onInit first), so no test writes to a half-built MongoDB database.
    onInit: waitForDatabaseSchema,
    secret: 'test-secret-key',
  })
