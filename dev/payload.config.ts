import type {CollectionSlug, TypedJobs} from 'payload';

import {sqliteAdapter} from "@payloadcms/db-sqlite"
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import path from 'path'
import {buildConfig} from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import {workflowsPlugin} from "../src/plugin/index.js"
import {HttpRequestStepTask} from "../src/steps/http-request.js"
import {CreateDocumentStepTask} from "../src/steps/index.js"
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  if (process.env.NODE_ENV === 'test') {
    const memoryDB = await MongoMemoryReplSet.create({
      replSet: {
        count: 3,
        dbName: 'payloadmemory',
      },
    })

    process.env.DATABASE_URI = `${memoryDB.getUri()}&retryWrites=true`
  }

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname, '..'),
      },
    },
    collections: [
      {
        slug: 'posts',
        fields: [
          {
            name: 'content',
            type: 'textarea'
          }
        ],
      },
      {
        slug: 'media',
        fields: [],
        upload: {
          staticDir: path.resolve(dirname, 'media'),
        },
      },
      {
        slug: 'auditLog',
        fields: [
          {
            name: 'post',
            type: 'relationship',
            relationTo: 'posts'
          },
          {
            name: 'user',
            type: 'relationship',
            relationTo: 'users',
            required: false
          },
          {
            name: 'message',
            type: 'textarea'
          }
        ]
      }
    ],
    db: sqliteAdapter({
      client: {
        url: `file:${path.resolve(dirname, 'payload.db')}`,
      },
    }),
    editor: lexicalEditor(),
    email: testEmailAdapter,
    jobs: {
      deleteJobOnComplete: false,
      jobsCollectionOverrides: ({ defaultJobsCollection }) => {
        return {
          ...defaultJobsCollection,
          admin: {
            ...(defaultJobsCollection.admin ?? {}),
            hidden: false,
          },
        }
      },
      tasks: []
    },
    onInit: async (payload) => {
      await seed(payload)
    },
    plugins: [
      workflowsPlugin<CollectionSlug>({
        collectionTriggers: {
          posts: true
        },
        steps: [
          HttpRequestStepTask,
          CreateDocumentStepTask
        ],
        triggers: [

        ],
        webhookPrefix: '/workflows-webhook'
      }),
    ],
    secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
    sharp,
    typescript: {
      outputFile: path.resolve(dirname, 'payload-types.ts'),
    },
  })
}

export default buildConfigWithMemoryDB()
