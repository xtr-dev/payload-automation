import type {CollectionConfig, Config} from 'payload'

import type {WorkflowsPluginConfig} from "./config-types.js"

import {createWorkflowCollection} from '../collections/Workflow.js'
import {WorkflowRunsCollection} from '../collections/WorkflowRuns.js'
import {WorkflowExecutor} from '../core/workflow-executor.js'
import {getConfigLogger, initializeLogger} from './logger.js'
import {createCollectionTriggerHook} from "./collection-hook.js"
import {createGlobalTriggerHook} from "./global-hook.js"

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

type AnyHook =
  CollectionConfig['hooks'] extends infer H
    ? H extends Record<string, unknown>
      ? NonNullable<H[keyof H]> extends (infer U)[]
        ? U
        : never
      : never
    : never;

type HookArgs = Parameters<AnyHook>[0]

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
        for (const [collectionSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
          if (!triggerConfig) {
            continue
          }

          // Find the collection config that matches
          const collectionIndex = config.collections.findIndex(c => c.slug === collectionSlug)
          if (collectionIndex === -1) {
            logger.warn(`Collection '${collectionSlug}' not found in config.collections`)
            continue
          }

          const collection = config.collections[collectionIndex]

          // Initialize hooks if needed
          if (!collection.hooks) {
            collection.hooks = {}
          }

          // Determine which hooks to register based on config
          const hooksToRegister = triggerConfig === true
            ? {
                afterChange: true,
                afterDelete: true,
                afterRead: true,
              }
            : triggerConfig

          // Register each configured hook
          Object.entries(hooksToRegister).forEach(([hookName, enabled]) => {
            if (!enabled) {
              return
            }

            const hookKey = hookName as keyof typeof collection.hooks

            // Initialize the hook array if needed
            if (!collection.hooks![hookKey]) {
              collection.hooks![hookKey] = []
            }

            // Create the automation hook for this specific collection and hook type
            const automationHook = createCollectionTriggerHook(collectionSlug, hookKey)

            // Mark it for debugging
            Object.defineProperty(automationHook, '__isAutomationHook', {
              value: true,
              enumerable: false
            })
            Object.defineProperty(automationHook, '__hookType', {
              value: hookKey,
              enumerable: false
            })

            // Add the hook to the collection
            ;(collection.hooks![hookKey] as Array<unknown>).push(automationHook)

            logger.debug(`Registered ${hookKey} hook for collection '${collectionSlug}'`)
          })
        }
      }

      // Handle global triggers similarly to collection triggers
      if (config.globals && pluginOptions.globalTriggers) {
        for (const [globalSlug, triggerConfig] of Object.entries(pluginOptions.globalTriggers)) {
          if (!triggerConfig) {
            continue
          }

          // Find the global config that matches
          const globalIndex = config.globals.findIndex(g => g.slug === globalSlug)
          if (globalIndex === -1) {
            logger.warn(`Global '${globalSlug}' not found in config.globals`)
            continue
          }

          const global = config.globals[globalIndex]

          // Initialize hooks if needed
          if (!global.hooks) {
            global.hooks = {}
          }

          // Determine which hooks to register based on config
          const hooksToRegister = triggerConfig === true
            ? {
                afterChange: true,
                afterRead: true,
              }
            : triggerConfig

          // Register each configured hook
          Object.entries(hooksToRegister).forEach(([hookName, enabled]) => {
            if (!enabled) {
              return
            }

            const hookKey = hookName as keyof typeof global.hooks

            // Initialize the hook array if needed
            if (!global.hooks![hookKey]) {
              global.hooks![hookKey] = []
            }

            // Create the automation hook for this specific global and hook type
            const automationHook = createGlobalTriggerHook(globalSlug, hookKey)

            // Mark it for debugging
            Object.defineProperty(automationHook, '__isAutomationHook', {
              value: true,
              enumerable: false
            })
            Object.defineProperty(automationHook, '__hookType', {
              value: hookKey,
              enumerable: false
            })

            // Add the hook to the global
            ;(global.hooks![hookKey] as Array<unknown>).push(automationHook)

            logger.debug(`Registered ${hookKey} hook for global '${globalSlug}'`)
          })
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

        // Log trigger configuration
        logger.info(`Plugin configuration: ${Object.keys(pluginOptions.collectionTriggers || {}).length} collection triggers, ${Object.keys(pluginOptions.globalTriggers || {}).length} global triggers, ${pluginOptions.steps?.length || 0} steps`)

        logger.info('Plugin initialized successfully - all hooks registered')
      }

      return config
    }
