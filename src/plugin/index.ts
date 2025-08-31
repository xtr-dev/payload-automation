import type {Config} from 'payload'

import type {WorkflowsPluginConfig} from "./config-types.js"

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

// Track if hooks have been initialized to prevent double registration
let hooksInitialized = false

export const workflowsPlugin =
  <TSlug extends string>(pluginOptions: WorkflowsPluginConfig<TSlug>) =>
    (config: Config): Config => {
      // If the plugin is disabled, return config unchanged
      if (pluginOptions.enabled === false) {
        return config
      }

      applyCollectionsConfig<TSlug>(pluginOptions, config)

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
        configLogger.info(`onInit called - hooks already initialized: ${hooksInitialized}, collections: ${Object.keys(payload.collections).length}`)
        
        // Prevent double initialization in dev mode
        if (hooksInitialized) {
          configLogger.warn('Hooks already initialized, skipping to prevent duplicate registration')
          return
        }
        
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
        const executor = new WorkflowExecutor(payload, logger)

        // Initialize hooks
        logger.info('Initializing collection hooks...')
        initCollectionHooks(pluginOptions, payload, logger, executor)
        
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
        hooksInitialized = true
      }

      return config
    }
