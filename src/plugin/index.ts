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

// Global executor registry for config-phase hooks
let globalExecutor: WorkflowExecutor | null = null

const setWorkflowExecutor = (executor: WorkflowExecutor) => {
  console.log('🚨 SETTING GLOBAL EXECUTOR')
  globalExecutor = executor
}

const getWorkflowExecutor = (): WorkflowExecutor | null => {
  return globalExecutor
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
          
          // Add our hook DIRECTLY to the collection config
          // This happens BEFORE PayloadCMS processes the config
          const automationHook = async (args: any) => {
            console.log('🔥🔥🔥 AUTOMATION HOOK FROM CONFIG PHASE! 🔥🔥🔥')
            console.log('Collection:', args.collection.slug)
            console.log('Operation:', args.operation)
            console.log('Doc ID:', args.doc?.id)
            
            // We'll need to get the executor from somewhere
            // For now, just prove the hook works
            console.log('🔥🔥🔥 CONFIG-PHASE HOOK SUCCESSFULLY EXECUTED! 🔥🔥🔥')
            
            // Try to get executor from global registry
            const executor = getWorkflowExecutor()
            if (executor) {
              console.log('✅ Executor available - executing workflows!')
              try {
                await executor.executeTriggeredWorkflows(
                  args.collection.slug,
                  args.operation,
                  args.doc,
                  args.previousDoc,
                  args.req
                )
                console.log('✅ Workflow execution completed!')
              } catch (error) {
                console.error('❌ Workflow execution failed:', error)
              }
            } else {
              console.log('⚠️ Executor not yet available')
            }
          }
          
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
        
        // Register executor globally
        setWorkflowExecutor(executor)

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
