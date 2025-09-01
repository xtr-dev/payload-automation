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
      
      // Revert: Don't apply hooks in config phase - user collections don't exist yet

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

        // DIRECT RUNTIME HOOK REGISTRATION - bypass all abstractions
        logger.info('Applying hooks directly to runtime collections...')
        
        for (const [collectionSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers || {})) {
          if (!triggerConfig) continue
          
          const collection = payload.collections[collectionSlug as TSlug]
          if (!collection) {
            logger.warn(`Collection '${collectionSlug}' not found at runtime`)
            continue
          }

          console.log(`🚨 DIRECTLY MANIPULATING ${collectionSlug} COLLECTION`)
          console.log(`🚨 Current afterChange hooks:`, collection.config.hooks?.afterChange?.length || 0)
          
          // Ensure hooks array exists
          if (!collection.config.hooks) {
            collection.config.hooks = {} as any // PayloadCMS hooks type is complex, bypass for direct manipulation
          }
          if (!collection.config.hooks.afterChange) {
            collection.config.hooks.afterChange = []
          }
          
          // Add ultra-simple test hook
          const ultraSimpleHook = async (change: { collection: { slug: string }, operation: string, doc?: { id?: string } }) => {
            console.log('🎯 ULTRA SIMPLE HOOK EXECUTED! 🎯')
            console.log('🎯 Collection:', change.collection.slug)
            console.log('🎯 Operation:', change.operation)
            console.log('🎯 SUCCESS - Direct runtime registration works!')
          }
          
          // Insert at beginning to ensure it runs first
          collection.config.hooks.afterChange.unshift(ultraSimpleHook)
          
          console.log(`🚨 Added hook to ${collectionSlug} - new count:`, collection.config.hooks.afterChange.length)
          
          logger.info(`Direct hook registration completed for: ${collectionSlug}`)
        }
        
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
