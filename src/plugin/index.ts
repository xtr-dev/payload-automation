import type { CollectionConfig, Config } from 'payload'

import type { WorkflowsPluginConfig } from './config-types.js'

import { createTriggersCollection } from '../collections/Triggers.js'
import { createStepsCollection } from '../collections/Steps.js'
import { createWorkflowCollection } from '../collections/Workflow.js'
import { WorkflowRunsCollection } from '../collections/WorkflowRuns.js'
import { getConfigLogger, initializeLogger } from './logger.js'
import { reconcileStaleRecords } from './reconcile-stale-records.js'
import { createCollectionTriggerHook, createGlobalTriggerHook } from './trigger-hook.js'

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

      // Seed workflows if configured
      if (pluginOptions.seedWorkflows && pluginOptions.seedWorkflows.length > 0) {
        logger.info(`Seeding ${pluginOptions.seedWorkflows.length} workflows...`)

        // Helper to generate slug from name
        const slugify = (str: string): string =>
          str.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')

        // workflow-runs.firedTrigger and stepResults[].step keep relationships
        // to automation-triggers/automation-steps documents after a workflow
        // is reconciled to new ones. A stale record referenced by a past run
        // must not be deleted, or that run's "what fired me" / "what did step
        // 2 do" becomes unresolvable - see the reseed test with an existing run.
        const isTriggerReferencedByRun = async (triggerId: string | number): Promise<boolean> => {
          const result = await payload.find({
            collection: 'workflow-runs',
            where: { firedTrigger: { equals: triggerId } },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          return result.docs.length > 0
        }
        const isStepReferencedByRun = async (stepId: string | number): Promise<boolean> => {
          const result = await payload.find({
            collection: 'workflow-runs',
            where: { 'stepResults.step': { equals: stepId } },
            limit: 1,
            depth: 0,
            overrideAccess: true,
          })
          return result.docs.length > 0
        }

        for (const seedWorkflow of pluginOptions.seedWorkflows) {
          // Tracks records created for THIS iteration so a failed workflow
          // create/update can roll them back instead of leaking them as
          // orphans (they aren't referenced by anything yet - the workflow
          // write that would point to them is what failed).
          const createdTriggerIds: (string | number)[] = []
          const createdStepIds: (string | number)[] = []
          // Flips once the workflow create/update lands, i.e. once
          // createdTriggerIds/createdStepIds are actually referenced by a
          // live workflow. A later failure (e.g. the stale-cleanup lookups
          // below) must not roll these back at that point - that would
          // delete records the just-written workflow now points to.
          let workflowWritten = false
          try {
            // Find any previously seeded workflow by its stable slug. Local
            // API calls in this block pass overrideAccess: true throughout -
            // the workflow access control now scopes update/delete to
            // non-readOnly documents, and seeded workflows are readOnly.
            const existingWorkflow = await payload.find({
              collection: 'workflows',
              where: {
                slug: {
                  equals: seedWorkflow.slug,
                },
              },
              limit: 1,
              overrideAccess: true,
            })

            const previousWorkflow = existingWorkflow.docs[0]

            // Create triggers in automation-triggers collection
            const triggerIds: (string | number)[] = []
            for (let i = 0; i < seedWorkflow.triggers.length; i++) {
              const triggerDef = seedWorkflow.triggers[i]
              const triggerName = `${seedWorkflow.name} - Trigger ${i + 1}`

              // Build trigger data based on type
              const triggerData: Record<string, unknown> = {
                name: triggerName,
                type: triggerDef.type,
                condition: triggerDef.condition,
              }

              // Map parameters to trigger fields based on type
              if (triggerDef.parameters) {
                if (triggerDef.type === 'collection-hook') {
                  triggerData.collectionSlug = triggerDef.parameters.collectionSlug
                  triggerData.hook = triggerDef.parameters.hook
                } else if (triggerDef.type === 'global-hook') {
                  triggerData.globalSlug = triggerDef.parameters.globalSlug
                  triggerData.hook = triggerDef.parameters.hook
                } else if (triggerDef.type === 'scheduled') {
                  triggerData.schedule = triggerDef.parameters.schedule
                } else if (triggerDef.type === 'webhook') {
                  triggerData.webhookPath = triggerDef.parameters.webhookPath
                }
              }

              const trigger = await payload.create({
                collection: 'automation-triggers',
                data: triggerData,
                overrideAccess: true,
              })
              triggerIds.push(trigger.id)
              createdTriggerIds.push(trigger.id)
              logger.debug(`Created trigger: ${triggerName}`)
            }

            // Create steps in automation-steps collection and build workflow steps array
            const workflowSteps: Array<{
              step: string | number
              slug: string
              stepName: string
              inputOverrides: Record<string, unknown>
              condition?: string
              dependencies?: Array<{ slug: string }>
            }> = []

            for (const stepDef of seedWorkflow.steps) {
              const stepName = `${seedWorkflow.name} - ${stepDef.name}`
              const stepSlug = stepDef.slug || slugify(stepDef.name)

              // Create step in automation-steps collection
              const step = await payload.create({
                collection: 'automation-steps',
                data: {
                  name: stepName,
                  type: stepDef.type,
                  config: stepDef.input || {},
                },
                overrideAccess: true,
              })
              createdStepIds.push(step.id)
              logger.debug(`Created step: ${stepName}`)

              // Add to workflow steps with relationship ID
              workflowSteps.push({
                step: step.id,
                slug: stepSlug,
                stepName: stepDef.name,
                inputOverrides: stepDef.input || {},
                condition: stepDef.condition,
                dependencies: stepDef.dependencies?.map(dep => ({ slug: dep })),
              })
            }

            if (previousWorkflow) {
              // Reconcile: point the existing workflow (found by its stable
              // slug) at the freshly created triggers/steps, then remove the
              // records it used to reference. Deleting only after the
              // workflow no longer points at them keeps a restart from
              // accumulating orphaned automation-triggers/automation-steps
              // rows every time a seed definition changes. A stale record
              // still named by a past workflow-runs.firedTrigger or
              // stepResults[].step is kept instead of deleted, so that run's
              // provenance stays resolvable even though the workflow itself
              // has moved on.
              type RelationValue = string | number | { id: string | number }
              const staleTriggerIds = (
                (previousWorkflow as { triggers?: RelationValue[] }).triggers || []
              ).map((t) => (typeof t === 'object' ? t.id : t))
              const staleStepIds = (
                (previousWorkflow as { steps?: Array<{ step: RelationValue }> }).steps || []
              ).map(({ step }) => (typeof step === 'object' ? step.id : step))

              await payload.update({
                collection: 'workflows',
                id: previousWorkflow.id,
                data: {
                  name: seedWorkflow.name,
                  description: seedWorkflow.description,
                  triggers: triggerIds,
                  steps: workflowSteps,
                  readOnly: true,
                },
                overrideAccess: true,
              })
              workflowWritten = true

              await reconcileStaleRecords(staleTriggerIds, {
                kind: 'trigger',
                isReferenced: isTriggerReferencedByRun,
                remove: (id) => payload.delete({
                  collection: 'automation-triggers',
                  id,
                  overrideAccess: true,
                }),
                logger,
              })
              await reconcileStaleRecords(staleStepIds, {
                kind: 'step',
                isReferenced: isStepReferencedByRun,
                remove: (id) => payload.delete({
                  collection: 'automation-steps',
                  id,
                  overrideAccess: true,
                }),
                logger,
              })

              logger.info(`Updated seeded workflow: ${seedWorkflow.name}`)
              continue
            }

            // Create the workflow with relationship IDs
            await payload.create({
              collection: 'workflows',
              data: {
                slug: seedWorkflow.slug,
                name: seedWorkflow.name,
                description: seedWorkflow.description,
                triggers: triggerIds,
                steps: workflowSteps,
                readOnly: true,
              },
              overrideAccess: true,
            })
            workflowWritten = true

            logger.info(`Seeded workflow: ${seedWorkflow.name}`)
          } catch (error) {
            // Roll back trigger/step records created this iteration, but only
            // if the workflow write that would reference them never landed -
            // once it has, these are live records a workflow points to, and
            // a later failure (e.g. in the stale-cleanup lookups) must not
            // delete them.
            if (!workflowWritten) {
              for (const id of createdTriggerIds) {
                await payload.delete({
                  collection: 'automation-triggers',
                  id,
                  overrideAccess: true,
                }).catch(() => {
                  // best-effort rollback; the outer error below is already the one that matters
                })
              }
              for (const id of createdStepIds) {
                await payload.delete({
                  collection: 'automation-steps',
                  id,
                  overrideAccess: true,
                }).catch(() => {
                  // best-effort rollback; the outer error below is already the one that matters
                })
              }
            }
            logger.error(`Failed to seed workflow '${seedWorkflow.name}':`, error)
          }
        }
      }

        logger.info(`Plugin configuration: ${collectionCount} collection triggers, ${globalCount} global triggers, ${stepCount} steps`
      )
    }

    if (!config.custom) {
      config.custom = {}
    }
    if (!config.custom.pluginConfigs) {
      config.custom.pluginConfigs = {}
    }
    config.custom.pluginConfigs['@xtr-dev/payload-automation'] = pluginOptions

    return config
  }
