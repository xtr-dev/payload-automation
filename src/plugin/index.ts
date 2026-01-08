import type { CollectionConfig, Config } from 'payload'

import type { WorkflowsPluginConfig } from './config-types.js'

import { createTriggersCollection } from '../collections/Triggers.js'
import { createStepsCollection } from '../collections/Steps.js'
import { createWorkflowCollection } from '../collections/Workflow.js'
import { WorkflowRunsCollection } from '../collections/WorkflowRuns.js'
import { getConfigLogger, initializeLogger } from './logger.js'
import { createCollectionTriggerHook, createGlobalTriggerHook } from './trigger-hook.js'
import { handleTestRun, handleExecutionStream, handleGetRunStatus } from '../api/handlers.js'

export { getLogger } from './logger.js'

const applyCollectionsConfig = <T extends string>(
  pluginOptions: WorkflowsPluginConfig<T>,
  config: Config
) => {
  if (!config.collections) {
    config.collections = []
  }

  // Add all automation collections
  config.collections.push(
    createTriggersCollection(pluginOptions),
    createStepsCollection(pluginOptions.steps),
    createWorkflowCollection(),
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
    : never

export const workflowsPlugin =
  <TSlug extends string>(pluginOptions: WorkflowsPluginConfig<TSlug>) =>
  (config: Config): Config => {
    // If the plugin is disabled, return config unchanged
    if (pluginOptions.enabled === false) {
      return config
    }

    applyCollectionsConfig<TSlug>(pluginOptions, config)

    // Register automation API endpoints
    if (!config.endpoints) {
      config.endpoints = []
    }

    config.endpoints.push(
      {
        path: '/automation/test-run',
        method: 'post',
        handler: handleTestRun
      },
      {
        path: '/automation/workflow-runs/:id/stream',
        method: 'get',
        handler: handleExecutionStream
      },
      {
        path: '/automation/workflow-runs/:id',
        method: 'get',
        handler: handleGetRunStatus
      }
    )

    const logger = getConfigLogger()

    // Register collection hooks
    if (config.collections && pluginOptions.collectionTriggers) {
      for (const [collectionSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
        if (!triggerConfig) {
          continue
        }

        const collectionIndex = config.collections.findIndex(c => c.slug === collectionSlug)
        if (collectionIndex === -1) {
          logger.warn(`Collection '${collectionSlug}' not found in config.collections`)
          continue
        }

        const collection = config.collections[collectionIndex]

        if (!collection.hooks) {
          collection.hooks = {}
        }

        const hooksToRegister = triggerConfig === true
          ? { afterChange: true, afterDelete: true, afterRead: true }
          : triggerConfig

        Object.entries(hooksToRegister).forEach(([hookName, enabled]) => {
          if (!enabled) {
            return
          }

          const hookKey = hookName as keyof typeof collection.hooks

          if (!collection.hooks![hookKey]) {
            collection.hooks![hookKey] = []
          }

          const automationHook = createCollectionTriggerHook(collectionSlug, hookKey)

          Object.defineProperty(automationHook, '__isAutomationHook', {
            value: true,
            enumerable: false
          })
          Object.defineProperty(automationHook, '__hookType', {
            value: hookKey,
            enumerable: false
          })

          ;(collection.hooks![hookKey] as Array<unknown>).push(automationHook)

          logger.debug(`Registered ${hookKey} hook for collection '${collectionSlug}'`)
        })
      }
    }

    // Register global hooks
    if (config.globals && pluginOptions.globalTriggers) {
      for (const [globalSlug, triggerConfig] of Object.entries(pluginOptions.globalTriggers)) {
        if (!triggerConfig) {
          continue
        }

        const globalIndex = config.globals.findIndex(g => g.slug === globalSlug)
        if (globalIndex === -1) {
          logger.warn(`Global '${globalSlug}' not found in config.globals`)
          continue
        }

        const global = config.globals[globalIndex]

        if (!global.hooks) {
          global.hooks = {}
        }

        const hooksToRegister = triggerConfig === true
          ? { afterChange: true, afterRead: true }
          : triggerConfig

        Object.entries(hooksToRegister).forEach(([hookName, enabled]) => {
          if (!enabled) {
            return
          }

          const hookKey = hookName as keyof typeof global.hooks

          if (!global.hooks![hookKey]) {
            global.hooks![hookKey] = []
          }

          const automationHook = createGlobalTriggerHook(globalSlug, hookKey)

          Object.defineProperty(automationHook, '__isAutomationHook', {
            value: true,
            enumerable: false
          })
          Object.defineProperty(automationHook, '__hookType', {
            value: hookKey,
            enumerable: false
          })

          ;(global.hooks![hookKey] as Array<unknown>).push(automationHook)

          logger.debug(`Registered ${hookKey} hook for global '${globalSlug}'`)
        })
      }
    }

    // Register step tasks
    if (!config.jobs) {
      config.jobs = { tasks: [] }
    }

    for (const step of pluginOptions.steps) {
      if (!config.jobs?.tasks?.find(task => task.slug === step.slug)) {
        config.jobs?.tasks?.push(step)
      }
    }

    // Extend payload-jobs collection with automation context fields
    const existingJobsOverrides = config.jobs.jobsCollectionOverrides
    config.jobs.jobsCollectionOverrides = ({ defaultJobsCollection }) => {
      // Apply any existing overrides first
      const collection = existingJobsOverrides
        ? existingJobsOverrides({ defaultJobsCollection })
        : defaultJobsCollection

      return {
        ...collection,
        fields: [
          ...collection.fields,
          // Structured automation context fields for admin UI integration
          {
            name: 'automationWorkflow',
            type: 'relationship',
            relationTo: 'workflows',
            admin: {
              position: 'sidebar',
              readOnly: true,
              description: 'Workflow that created this job',
            },
          },
          {
            name: 'automationWorkflowRun',
            type: 'relationship',
            relationTo: 'workflow-runs',
            admin: {
              position: 'sidebar',
              readOnly: true,
              description: 'Workflow run that created this job',
            },
          },
          {
            name: 'automationTrigger',
            type: 'relationship',
            relationTo: 'automation-triggers',
            admin: {
              position: 'sidebar',
              readOnly: true,
              description: 'Trigger that initiated the workflow',
            },
          },
          {
            name: 'automationStepName',
            type: 'text',
            admin: {
              position: 'sidebar',
              readOnly: true,
              description: 'Name of the workflow step that created this job',
            },
          },
        ],
        admin: {
          ...collection.admin,
          listSearchableFields: [
            ...(collection.admin?.listSearchableFields || []),
          ],
          defaultColumns: [
            ...(collection.admin?.defaultColumns || ['taskSlug', 'queue', 'processing', 'completedAt']),
          ],
        },
      }
    }

    // Set up onInit
    const incomingOnInit = config.onInit
    config.onInit = async (payload) => {
      if (incomingOnInit) {
        await incomingOnInit(payload)
      }

      const logger = initializeLogger(payload)
      logger.info('Automation plugin initialized')

      const collectionCount = Object.keys(pluginOptions.collectionTriggers || {}).length
      const globalCount = Object.keys(pluginOptions.globalTriggers || {}).length
      const stepCount = pluginOptions.steps?.length || 0

      logger.info(
        `Plugin configuration: ${collectionCount} collection triggers, ${globalCount} global triggers, ${stepCount} steps`
      )
    }

    return config
  }
