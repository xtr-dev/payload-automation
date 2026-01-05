import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

export const seed = async (payload: Payload) => {
  // Seed dev user
  const { totalDocs: userCount } = await payload.count({
    collection: 'users',
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!userCount) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
    payload.logger.info('Created dev user')
  }

  // Check if we already have seeded data
  const { totalDocs: triggerCount } = await payload.count({
    collection: 'automation-triggers',
  })

  if (triggerCount > 0) {
    payload.logger.info('Seed data already exists, skipping...')
    return
  }

  // Create example triggers
  payload.logger.info('Creating example triggers...')

  const postChangeTrigger = await payload.create({
    collection: 'automation-triggers',
    data: {
      name: 'Posts After Change',
      description: 'Fires when a post is created or updated',
      type: 'collection-hook',
      collectionSlug: 'posts',
      hook: 'afterChange',
    },
  })

  const postPublishedTrigger = await payload.create({
    collection: 'automation-triggers',
    data: {
      name: 'Post Published',
      description: 'Fires when a post status changes to published',
      type: 'collection-hook',
      collectionSlug: 'posts',
      hook: 'afterChange',
      condition: '{{trigger.doc._status}} == "published"',
      conditionDescription: 'Only when status is published',
    },
  })

  payload.logger.info('Created 2 example triggers')

  // Create example steps
  payload.logger.info('Creating example steps...')

  const logChangeStep = await payload.create({
    collection: 'automation-steps',
    data: {
      name: 'Log to HTTP Endpoint',
      description: 'Sends a POST request to an HTTP endpoint to log events',
      type: 'http-request-step',
      config: {
        url: 'https://httpbin.org/post',
        method: 'POST',
        body: {
          event: 'document_changed',
          documentId: '{{trigger.doc.id}}',
          collection: '{{trigger.collection}}'
        }
      },
      color: '#3b82f6',
    },
  })

  const notifyStep = await payload.create({
    collection: 'automation-steps',
    data: {
      name: 'Send Notification',
      description: 'Sends a notification about the event',
      type: 'http-request-step',
      config: {
        url: 'https://httpbin.org/post',
        method: 'POST',
        body: {
          type: 'notification',
          message: 'Document {{trigger.doc.id}} was published'
        }
      },
      color: '#10b981',
    },
  })

  payload.logger.info('Created 2 example steps')

  // Create example workflows
  payload.logger.info('Creating example workflows...')

  await payload.create({
    collection: 'workflows',
    data: {
      name: 'Log Post Changes',
      description: 'Logs when a post is created or updated',
      enabled: true,
      triggers: [postChangeTrigger.id],
      steps: [
        {
          step: logChangeStep.id,
          stepName: 'Log Change',
        }
      ],
      errorHandling: 'stop',
      _status: 'published',
    },
  })

  await payload.create({
    collection: 'workflows',
    data: {
      name: 'Notify on Publish',
      description: 'Sends a notification when a post is published',
      enabled: true,
      triggers: [postPublishedTrigger.id],
      steps: [
        {
          step: notifyStep.id,
          stepName: 'Send Publish Notification',
        }
      ],
      errorHandling: 'stop',
      _status: 'published',
    },
  })

  payload.logger.info('Created 2 example workflows')
  payload.logger.info('Seed completed successfully')
}
