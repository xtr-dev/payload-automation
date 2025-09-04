import type {Config} from 'payload'

import type {WorkflowsPluginConfig, CollectionTriggerConfigCrud} from "./config-types.js"

import {createWorkflowCollection} from '../collections/Workflow.js'
import {WorkflowRunsCollection} from '../collections/WorkflowRuns.js'
import {WorkflowExecutor} from '../core/workflow-executor.js'
import {generateCronTasks, registerCronJobs} from './cron-scheduler.js'
import {initCollectionHooks} from "./init-collection-hooks.js"
import {initGlobalHooks} from "./init-global-hooks.js"
import {initStepTasks} from "./init-step-tasks.js"
import {initWebhookEndpoint} from "./init-webhook.js"
import {initWorkflowHooks} from './init-workflow-hooks.js'
import {getConfigLogger, initializeLogger} from './logger.js'

export {getLogger} from './logger.js'

// Improved executor registry with proper error handling and logging
interface ExecutorRegistry {
  executor: WorkflowExecutor | null
  logger: any | null
  isInitialized: boolean
}

const executorRegistry: ExecutorRegistry = {
  executor: null,
  logger: null,
  isInitialized: false
}

const setWorkflowExecutor = (executor: WorkflowExecutor, logger: any) => {
  executorRegistry.executor = executor
  executorRegistry.logger = logger
  executorRegistry.isInitialized = true
  
  logger.info('Workflow executor initialized and registered successfully')
}

const getExecutorRegistry = (): ExecutorRegistry => {
  return executorRegistry
}

// Helper function to create failed workflow runs for tracking errors
const createFailedWorkflowRun = async (args: any, errorMessage: string, logger: any) => {
  try {
    // Only create failed workflow runs if we have enough context
    if (!args?.req?.payload || !args?.collection?.slug) {
      return
    }
    
    // Find workflows that should have been triggered
    const workflows = await args.req.payload.find({
      collection: 'workflows',
      where: {
        'triggers.type': {
          equals: 'collection-trigger'
        },
        'triggers.collectionSlug': {
          equals: args.collection.slug
        },
        'triggers.operation': {
          equals: args.operation
        }
      },
      limit: 10,
      req: args.req
    })
    
    // Create failed workflow runs for each matching workflow
    for (const workflow of workflows.docs) {
      await args.req.payload.create({
        collection: 'workflow-runs',
        data: {
          workflow: workflow.id,
          workflowVersion: 1,
          status: 'failed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: `Hook execution failed: ${errorMessage}`,
          triggeredBy: args?.req?.user?.email || 'system',
          context: {
            trigger: {
              type: 'collection',
              collection: args.collection.slug,
              operation: args.operation,
              doc: args.doc,
              previousDoc: args.previousDoc,
              triggeredAt: new Date().toISOString()
            },
            steps: {}
          },
          inputs: {},
          outputs: {},
          steps: [],
          logs: [{
            level: 'error',
            message: `Hook execution failed: ${errorMessage}`,
            timestamp: new Date().toISOString()
          }]
        },
        req: args.req
      })
    }
    
    if (workflows.docs.length > 0) {
      logger.info({
        workflowCount: workflows.docs.length,
        errorMessage
      }, 'Created failed workflow runs for hook execution error')
    }
    
  } catch (error) {
    // Don't let workflow run creation failures break the original operation
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

// Removed config-phase hook registration - user collections don't exist during config phase


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
      logger.info('Attempting to modify collection configs before PayloadCMS initialization...')
      
      if (config.collections && pluginOptions.collectionTriggers) {
        for (const [triggerSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
          if (!triggerConfig) continue
          
          // Find the collection config that matches
          const collectionIndex = config.collections.findIndex(c => c.slug === triggerSlug)
          if (collectionIndex === -1) {
            logger.warn(`Collection '${triggerSlug}' not found in config.collections`)
            continue
          }
          
          const collection = config.collections[collectionIndex]
          logger.info(`Found collection '${triggerSlug}' - modifying its hooks...`)
          
          // Initialize hooks if needed
          if (!collection.hooks) {
            collection.hooks = {}
          }
          if (!collection.hooks.afterChange) {
            collection.hooks.afterChange = []
          }
          
          // Create a reliable hook function with proper dependency injection
          const automationHook = Object.assign(
            async function payloadAutomationHook(args: any) {
              const registry = getExecutorRegistry()
              
              // Use proper logger if available, fallback to args.req.payload.logger
              const logger = registry.logger || args?.req?.payload?.logger || console
              
              try {
                logger.info({
                  collection: args?.collection?.slug,
                  operation: args?.operation,
                  docId: args?.doc?.id,
                  hookType: 'automation'
                }, 'Collection automation hook triggered')
                
                if (!registry.isInitialized) {
                  logger.warn('Workflow executor not yet initialized, skipping execution')
                  return undefined
                }
                
                if (!registry.executor) {
                  logger.error('Workflow executor is null despite being marked as initialized')
                  // Create a failed workflow run to track this issue
                  await createFailedWorkflowRun(args, 'Executor not available', logger)
                  return undefined
                }
                
                logger.debug('Executing triggered workflows...')
                await registry.executor.executeTriggeredWorkflows(
                  args.collection.slug,
                  args.operation,
                  args.doc,
                  args.previousDoc,
                  args.req
                )
                
                logger.info({
                  collection: args?.collection?.slug,
                  operation: args?.operation,
                  docId: args?.doc?.id
                }, 'Workflow execution completed successfully')
                
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                
                logger.error({
                  error: errorMessage,
                  errorStack: error instanceof Error ? error.stack : undefined,
                  collection: args?.collection?.slug,
                  operation: args?.operation,
                  docId: args?.doc?.id
                }, 'Hook execution failed')
                
                // Create a failed workflow run to track this error
                try {
                  await createFailedWorkflowRun(args, errorMessage, logger)
                } catch (createError) {
                  logger.error({
                    error: createError instanceof Error ? createError.message : 'Unknown error'
                  }, 'Failed to create workflow run for hook error')
                }
                
                // Don't throw to prevent breaking the original operation
              }
              
              return undefined
            },
            {
              __isAutomationHook: true,
              __version: '0.0.22'
            }
          )
          
          // Add the hook to the collection config
          collection.hooks.afterChange.push(automationHook)
          logger.info(`Added automation hook to '${triggerSlug}' - hook count: ${collection.hooks.afterChange.length}`)
        }
      }

      if (!config.jobs) {
        config.jobs = {tasks: []}
      }

      const configLogger = getConfigLogger()
      configLogger.info(`Configuring workflow plugin with ${Object.keys(pluginOptions.collectionTriggers || {}).length} collection triggers`)

      // Generate cron tasks for workflows with cron triggers
      generateCronTasks(config)

      for (const step of pluginOptions.steps) {
        if (!config.jobs?.tasks?.find(task => task.slug === step.slug)) {
          configLogger.debug(`Registering task: ${step.slug}`)
          config.jobs?.tasks?.push(step)
        } else {
          configLogger.debug(`Task ${step.slug} already registered, skipping`)
        }
      }

      // Initialize webhook endpoint
      initWebhookEndpoint(config, pluginOptions.webhookPrefix || 'webhook')

      // Set up onInit to register collection hooks and initialize features
      const incomingOnInit = config.onInit
      config.onInit = async (payload) => {
        configLogger.info(`onInit called - collections: ${Object.keys(payload.collections).length}`)
        
        // Execute any existing onInit functions first
        if (incomingOnInit) {
          configLogger.debug('Executing existing onInit function')
          await incomingOnInit(payload)
        }

        // Initialize the logger with the payload instance
        const logger = initializeLogger(payload)
        logger.info('Logger initialized with payload instance')

        // Log collection trigger configuration
        logger.info(`Plugin configuration: ${Object.keys(pluginOptions.collectionTriggers || {}).length} collection triggers, ${pluginOptions.steps?.length || 0} steps`)

        // Create workflow executor instance
        console.log('🚨 CREATING WORKFLOW EXECUTOR INSTANCE')
        const executor = new WorkflowExecutor(payload, logger)
        console.log('🚨 EXECUTOR CREATED:', typeof executor)
        console.log('🚨 EXECUTOR METHODS:', Object.getOwnPropertyNames(Object.getPrototypeOf(executor)))
        
        // Register executor with proper dependency injection
        setWorkflowExecutor(executor, logger)

        // Hooks are now registered during config phase - just log status
        logger.info('Hooks were registered during config phase - executor now available')
        
        logger.info('Initializing global hooks...')
        initGlobalHooks(payload, logger, executor)
        
        logger.info('Initializing workflow hooks...')
        initWorkflowHooks(payload, logger)
        
        logger.info('Initializing step tasks...')
        initStepTasks(pluginOptions, payload, logger)

        // Register cron jobs for workflows with cron triggers
        logger.info('Registering cron jobs...')
        await registerCronJobs(payload, logger)

        logger.info('Plugin initialized successfully - all hooks registered')
      }

      return config
    }
