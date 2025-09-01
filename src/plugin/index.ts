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

const applyHooksToCollections = <T extends string>(pluginOptions: WorkflowsPluginConfig<T>, config: Config) => {
  const configLogger = getConfigLogger()
  
  if (!pluginOptions.collectionTriggers || Object.keys(pluginOptions.collectionTriggers).length === 0) {
    configLogger.warn('No collection triggers configured - hooks will not be applied')
    return
  }

  configLogger.info('Applying hooks to collections during config phase')

  // Apply hooks to each configured collection
  for (const [collectionSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
    if (!triggerConfig) {
      continue
    }

    // Find the collection in the config
    const collectionConfig = config.collections?.find(c => c.slug === collectionSlug)
    if (!collectionConfig) {
      configLogger.warn(`Collection '${collectionSlug}' not found in config - cannot apply hooks`)
      continue
    }

    const crud: CollectionTriggerConfigCrud = triggerConfig === true ? {
      create: true,
      delete: true,
      read: true,
      update: true,
    } : triggerConfig

    // Initialize hooks if they don't exist
    if (!collectionConfig.hooks) {
      collectionConfig.hooks = {}
    }

    // Apply afterChange hook for create/update operations
    if (crud.update || crud.create) {
      if (!collectionConfig.hooks.afterChange) {
        collectionConfig.hooks.afterChange = []
      }

      // Add our automation hook - this will be called when the executor is ready
      collectionConfig.hooks.afterChange.push(async (change) => {
        console.log('🚨 CONFIG-PHASE AUTOMATION HOOK CALLED! 🚨')
        console.log('Collection:', change.collection.slug)
        console.log('Operation:', change.operation)
        console.log('Doc ID:', change.doc?.id)

        // Get the executor from global registry (set during onInit)
        const executor = getWorkflowExecutor()
        if (!executor) {
          console.log('❌ No executor available yet - workflow execution skipped')
          return
        }

        console.log('✅ Executor found - executing workflows')
        
        try {
          await executor.executeTriggeredWorkflows(
            change.collection.slug,
            change.operation as 'create' | 'update',
            change.doc,
            change.previousDoc,
            change.req
          )
          console.log('🚨 executeTriggeredWorkflows completed successfully')
        } catch (error) {
          console.log('🚨 executeTriggeredWorkflows failed:', error)
        }
      })
    }

    configLogger.info(`Applied hooks to collection: ${collectionSlug}`)
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
      
      // CRITICAL FIX: Apply hooks during config phase, not onInit
      applyHooksToCollections<TSlug>(pluginOptions, config)

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
        
        // Register executor globally for config-phase hooks
        setWorkflowExecutor(executor)

        // Note: Collection hooks are now applied during config phase, not here
        logger.info('Collection hooks applied during config phase - executor now available for them')
        
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
