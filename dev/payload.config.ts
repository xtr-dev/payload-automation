import type {CollectionSlug} from 'payload';

import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import {buildConfig} from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import {workflowsPlugin} from "../src/plugin/index.js"
import type {SeedWorkflow} from "../src/plugin/config-types.js"
import {CreateDocumentStepTask,HttpRequestStepTask} from "../src/steps/index.js"
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

// Example seed workflows - these will be created as read-only templates
const exampleWorkflows: SeedWorkflow[] = [
  {
    slug: 'example-log-post-changes',
    name: 'Example: Log Post Changes',
    description: 'Automatically create an audit log entry whenever a post is created or updated',
    triggers: [
      {
        type: 'collection',
        parameters: {
          collection: 'posts',
          hook: 'afterChange',
        },
      },
    ],
    steps: [
      {
        name: 'Create Audit Log',
        type: 'create-document',
        input: {
          collection: 'auditLog',
          data: {
            post: '$.trigger.doc.id',
            message: 'Post was modified',
            user: '$.trigger.context.req.user.id',
          },
        },
      },
    ],
  },
  {
    slug: 'example-webhook-notification',
    name: 'Example: External Webhook Notification',
    description: 'Send a webhook notification to an external service when a new post is published',
    triggers: [
      {
        type: 'collection',
        parameters: {
          collection: 'posts',
          hook: 'afterCreate',
        },
      },
    ],
    steps: [
      {
        name: 'Send Webhook',
        type: 'http-request',
        input: {
          url: 'https://webhook.site/your-unique-id',
          method: 'POST',
          body: {
            event: 'post.created',
            postId: '$.trigger.doc.id',
            content: '$.trigger.doc.content',
          },
        },
      },
    ],
  },
]

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const buildConfigWithMemoryDB = async () => {
  // Use MongoDB adapter for testing instead of SQLite
  const { mongooseAdapter } = await import('@payloadcms/db-mongodb')

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
    db: mongooseAdapter({
      url: process.env.DATABASE_URI || 'mongodb://localhost:27017/payload-test',
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
        seedWorkflows: exampleWorkflows,
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
