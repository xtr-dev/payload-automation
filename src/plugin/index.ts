import type {
  CollectionAfterChangeHook,
  Config,
  PayloadRequest,
  TypeWithID
} from 'payload'

import type {WorkflowsPluginConfig} from "./config-types.js"

import {createWorkflowCollection} from '../collections/Workflow.js'
import {WorkflowRunsCollection} from '../collections/WorkflowRuns.js'
import {WorkflowExecutor} from '../core/workflow-executor.js'
import {initGlobalHooks} from "./init-global-hooks.js"
import {initStepTasks} from "./init-step-tasks.js"
import {initWebhookEndpoint} from "./init-webhook.js"
import {initWorkflowHooks} from './init-workflow-hooks.js'
import {getConfigLogger, initializeLogger} from './logger.js'

export {getLogger} from './logger.js'

/**
 * Helper function to create failed workflow runs for tracking errors
 */
const createFailedWorkflowRun = async (
  collectionSlug: string,
  operation: string,
  doc: TypeWithID,
  previousDoc: TypeWithID,
  req: PayloadRequest,
  errorMessage: string
): Promise<void> => {
  try {
    const logger = req?.payload?.logger || console

    // Only create failed workflow runs if we have a payload instance
    if (!req?.payload || !collectionSlug) {
      return
    }

    // Find workflows that should have been triggered
    const workflows = await req.payload.find({
      collection: 'workflows',
      limit: 10,
      req,
      where: {
        'triggers.parameters.collectionSlug': {
          equals: collectionSlug
        },
        'triggers.parameters.operation': {
          equals: operation
        },
        'triggers.type': {
          equals: 'collection'
        }
      }
    })

    // Create failed workflow runs for each matching workflow
    for (const workflow of workflows.docs) {
      await req.payload.create({
        collection: 'workflow-runs',
        data: {
          completedAt: new Date().toISOString(),
          context: {
            steps: {},
            trigger: {
              type: 'collection',
              collection: collectionSlug,
              doc,
              operation,
              previousDoc,
              triggeredAt: new Date().toISOString()
            }
          },
          error: `Hook execution failed: ${errorMessage}`,
          inputs: {},
          logs: [{
            level: 'error',
            message: `Hook execution failed: ${errorMessage}`,
            timestamp: new Date().toISOString()
          }],
          outputs: {},
          startedAt: new Date().toISOString(),
          status: 'failed',
          steps: [],
          triggeredBy: req?.user?.email || 'system',
          workflow: workflow.id,
          workflowVersion: 1
        },
        req
      })
    }

    if (workflows.docs.length > 0) {
      logger.info({
        errorMessage,
        workflowCount: workflows.docs.length
      }, 'Created failed workflow runs for hook execution error')
    }

  } catch (error) {
    // Don't let workflow run creation failures break the original operation
    const logger = req?.payload?.logger || console
    logger.warn({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 'Failed to create failed workflow run record')
  }
}

const applyCollectionsConfig = <T extends string>(pluginOptions: WorkflowsPluginConfig<T>, config: Config) => {
  // Add workflow collections
  if (!config.collections) {
    config.collections = []
  }

  config.collections.push(
    createWorkflowCollection(pluginOptions),
    WorkflowRunsCollection
  )
}

/**
 * Create a collection hook that executes workflows
 */
const createAutomationHook = <T extends TypeWithID>(): CollectionAfterChangeHook<T> => {
  return async function payloadAutomationHook(args) {
    const logger = args.req?.payload?.logger || console

    try {
      logger.info({
        collection: args.collection?.slug,
        docId: args.doc?.id,
        hookType: 'automation',
        operation: args.operation
      }, 'Collection automation hook triggered')

      // Create executor on-demand
      const executor = new WorkflowExecutor(args.req.payload, logger)

      logger.debug('Executing triggered workflows...')
      await executor.executeTriggeredWorkflows(
        args.collection.slug,
        args.operation,
        args.doc,
        args.previousDoc,
        args.req
      )

      logger.info({
        collection: args.collection?.slug,
        docId: args.doc?.id,
        operation: args.operation
      }, 'Workflow execution completed successfully')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      logger.error({
        collection: args.collection?.slug,
        docId: args.doc?.id,
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
        operation: args.operation
      }, 'Hook execution failed')

      // Create a failed workflow run to track this error
      try {
        await createFailedWorkflowRun(
          args.collection.slug,
          args.operation,
          args.doc,
          args.previousDoc,
          args.req,
          errorMessage
        )
      } catch (createError) {
        logger.error({
          error: createError instanceof Error ? createError.message : 'Unknown error'
        }, 'Failed to create workflow run for hook error')
      }

      // Don't throw to prevent breaking the original operation
    }
  }
}

export const workflowsPlugin =
  <TSlug extends string>(pluginOptions: WorkflowsPluginConfig<TSlug>) =>
    (config: Config): Config => {
      // If the plugin is disabled, return config unchanged
      if (pluginOptions.enabled === false) {
        return config
      }

      applyCollectionsConfig<TSlug>(pluginOptions, config)

      // CRITICAL: Modify existing collection configs BEFORE PayloadCMS processes them
      // This is the ONLY time we can add hooks that will actually work
      const logger = getConfigLogger()

      if (config.collections && pluginOptions.collectionTriggers) {
        for (const [triggerSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
          if (!triggerConfig) {continue}

          // Find the collection config that matches
          const collectionIndex = config.collections.findIndex(c => c.slug === triggerSlug)
          if (collectionIndex === -1) {
            logger.warn(`Collection '${triggerSlug}' not found in config.collections`)
            continue
          }

          const collection = config.collections[collectionIndex]

          // Initialize hooks if needed
          if (!collection.hooks) {
            collection.hooks = {}
          }
          if (!collection.hooks.afterChange) {
            collection.hooks.afterChange = []
          }

          // Add the hook to the collection config
          const automationHook = createAutomationHook()
          // Mark it for debugging
          Object.defineProperty(automationHook, '__isAutomationHook', {
            value: true,
            enumerable: false
          })

          collection.hooks.afterChange.push(automationHook)
        }
      }

      if (!config.jobs) {
        config.jobs = {tasks: []}
      }

      for (const step of pluginOptions.steps) {
        if (!config.jobs?.tasks?.find(task => task.slug === step.slug)) {
          config.jobs?.tasks?.push(step)
        }
      }

      // Initialize webhook endpoint
      initWebhookEndpoint(config, pluginOptions.webhookPrefix || 'webhook')

      // Set up onInit to initialize features
      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        // Execute any existing onInit functions first
        if (incomingOnInit) {
          await incomingOnInit(payload)
        }

        // Initialize the logger with the payload instance
        const logger = initializeLogger(payload)
        logger.info('Logger initialized with payload instance')

        // Log collection trigger configuration
        logger.info(`Plugin configuration: ${Object.keys(pluginOptions.collectionTriggers || {}).length} collection triggers, ${pluginOptions.steps?.length || 0} steps`)

        logger.info('Initializing global hooks...')
        // Create executor for global hooks
        const executor = new WorkflowExecutor(payload, logger)
        initGlobalHooks(payload, logger, executor)

        logger.info('Initializing workflow hooks...')
        initWorkflowHooks(payload, logger)

        logger.info('Initializing step tasks...')
        initStepTasks(pluginOptions, payload, logger)

        logger.info('Plugin initialized successfully - all hooks registered')
      }

      return config
    }
