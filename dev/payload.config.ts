import type {CollectionSlug} from 'payload';

import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import {buildConfig} from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import {workflowsPlugin} from "../src/plugin/index.js"
import {CreateDocumentStepTask,HttpRequestStepTask} from "../src/steps/index.js"
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  // Use SQLite adapter for easier local testing
  const { sqliteAdapter } = await import('@payloadcms/db-sqlite')

  return buildConfig({
    admin: {
      importMap: {
        baseDir: path.resolve(dirname, '..'),
      },
    },
    globals: [
      {
        slug: 'settings',
        fields: [
          {
            name: 'siteName',
            type: 'text'
          }
        ]
      }
    ],
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
        url: process.env.DATABASE_URI || `file:${path.resolve(dirname, 'data/automation-dev.db')}`,
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
          posts: true,
          media: true
        },
        globalTriggers: {
          settings: true
        },
        steps: [
          HttpRequestStepTask,
          CreateDocumentStepTask
        ],
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
