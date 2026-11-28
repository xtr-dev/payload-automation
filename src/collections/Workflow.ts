import type { CollectionConfig } from 'payload'

import { ValidationError } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import { adminUserAccess, readOnlyWorkflowLock, resolveCollectionAccess } from './access.js'
import { findStepSlugErrors, sameStepSlugs } from '../utils/step-slugs.js'

/**
 * Creates the workflows collection.
 * Workflows reference triggers and steps via relationships for reusability.
 */
export const createWorkflowCollection = (
  options: WorkflowsPluginConfig
): CollectionConfig => {
  return {
    slug: 'workflows',
    access: resolveCollectionAccess(
      options,
      'workflows',
      {
        create: adminUserAccess,
        delete: adminUserAccess,
        read: adminUserAccess,
        // Versions are enabled below, and version snapshots carry the same
        // data as the workflow itself (step inputOverrides can hold
        // credentials), so reading them needs the same bar as reading the
        // workflow. Payload's fallback for an unset readVersions/unlock is
        // "any logged-in user from any auth collection".
        readVersions: adminUserAccess,
        unlock: adminUserAccess,
        update: adminUserAccess,
      },
      {
        // Applied on top of the defaults and any `access` override, so seeded
        // read-only workflows stay locked whoever is allowed to edit workflows.
        delete: readOnlyWorkflowLock,
        update: readOnlyWorkflowLock,
      },
    ),
    admin: {
      defaultColumns: ['name', 'slug', 'readOnly', 'enabled', 'updatedAt'],
      description: 'Create and manage automated workflows.',
      group: 'Automation',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        admin: {
          description: 'Human-readable name for the workflow',
        },
        required: true,
      },
      {
        name: 'slug',
        type: 'text',
        admin: {
          description: 'URL-safe unique identifier for this workflow',
          position: 'sidebar',
        },
        index: true,
        unique: true,
      },
      {
        name: 'readOnly',
        type: 'checkbox',
        // automation-triggers and automation-steps refuse update/delete for any
        // document a readOnly:true workflow references (readonly-access.ts), so
        // this flag isn't just self-protection anymore - anyone who could set it
        // could freeze someone else's trigger/step. `create`/`update` access:()=>false
        // means only Local API calls that don't pass overrideAccess:false can set
        // it (that's how the plugin's own seeder in plugin/seed-workflows.ts writes it);
        // REST, GraphQL, and any access-controlled Local API call cannot.
        access: {
          create: () => false,
          update: () => false,
        },
        admin: {
          description: 'Read-only workflows cannot be edited or deleted. This is typically used for seeded template workflows.',
          position: 'sidebar',
          readOnly: true,
        },
        defaultValue: false,
      },
      {
        name: 'readOnlyBanner',
        type: 'ui',
        admin: {
          components: {
            Field: '@xtr-dev/payload-automation/client#ReadOnlyBanner',
          },
          condition: (data) => data?.readOnly === true,
        },
      },
      {
        name: 'description',
        type: 'textarea',
        admin: {
          description: 'Optional description of what this workflow does',
        },
      },
      {
        name: 'enabled',
        type: 'checkbox',
        admin: {
          description: 'Enable or disable this workflow',
          position: 'sidebar',
        },
        defaultValue: true,
      },
      // Triggers - relationship to automation-triggers collection
      {
        name: 'triggers',
        type: 'relationship',
        admin: {
          description: 'Triggers that can start this workflow. Uses OR logic - workflow runs if ANY trigger fires.',
        },
        hasMany: true,
        relationTo: 'automation-triggers',
      },
      // Steps with workflow-specific configuration
      {
        name: 'steps',
        type: 'array',
        admin: {
          description: 'Steps to execute when this workflow runs. Steps execute in order based on dependencies.',
        },
        fields: [
          {
            name: 'step',
            type: 'relationship',
            admin: {
              description: 'Select a step from the step library',
            },
            relationTo: 'automation-steps',
            required: true,
          },
          {
            name: 'slug',
            type: 'text',
            required: true,
            admin: {
              description: 'Identifier of this step within the workflow, used in expressions (steps.<slug>) and dependencies. Two steps of one workflow cannot share a slug.',
            },
          },
          {
            name: 'stepName',
            type: 'text',
            admin: {
              description: 'Override the step name for this workflow instance (optional)',
            },
          },
          {
            name: 'inputOverrides',
            type: 'json',
            admin: {
              description: 'Override step configuration values for this workflow. Merged with step defaults.',
            },
            defaultValue: {},
          },
          {
            name: 'condition',
            type: 'code',
            admin: {
              description: 'JSONata expression that must evaluate to true for this step to execute. Leave empty to always run. Example: trigger.operation = "create"',
              language: 'javascript',
            },
          },
          {
            name: 'dependencies',
            type: 'array',
            admin: {
              description: 'Steps that must complete before this step can run. Reference steps by their slug.',
            },
            fields: [
              {
                name: 'slug',
                type: 'text',
                admin: {
                  description: 'Slug of the dependent step',
                },
                required: true,
              },
            ],
          },
        ],
      },
      // Global workflow settings
      {
        type: 'collapsible',
        label: 'Error Handling',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'errorHandling',
            type: 'select',
            admin: {
              description: 'What happens when a step fails. "Stop": the run fails at the first failed step. "Continue": the remaining steps still run, except those that depend on the failed step, and the run ends as completed. "Retry": every step is retried with the settings below, and the run fails when a step still fails after its last retry. A step with its own "Retry this step if it fails" setting is retried with that step\'s settings under all three options, and only counts as failed after its last retry.',
            },
            defaultValue: 'stop',
            options: [
              { label: 'Stop workflow', value: 'stop' },
              { label: 'Continue to next step', value: 'continue' },
              { label: 'Retry failed step, then stop workflow', value: 'retry' },
            ],
          },
          {
            name: 'maxRetries',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.errorHandling === 'retry',
              description: 'How many times a failed step is retried before the run fails (3 when empty; 3 means up to 4 attempts). Steps with their own retry setting use that instead.',
            },
            defaultValue: 3,
            min: 0,
          },
          {
            name: 'retryDelay',
            type: 'number',
            admin: {
              condition: (_, siblingData) => siblingData?.errorHandling === 'retry',
              description: 'Milliseconds to wait before each retry (1000 when empty). Steps with their own retry setting use that instead.',
            },
            defaultValue: 1000,
            min: 0,
          },
          {
            name: 'timeout',
            type: 'number',
            admin: {
              description: 'Maximum duration of a whole run in milliseconds, including retries and the waits between them (0 or empty for no limit). When it passes, the run fails with "Workflow timed out", whatever the error handling setting: steps still running are recorded as failed, no further step or retry starts. A step that is already running is not interrupted, only its result is discarded.',
            },
            defaultValue: 300000, // 5 minutes
            min: 0,
          },
        ],
      },
      {
        type: 'collapsible',
        label: 'Run History',
        admin: {
          initCollapsed: true,
        },
        fields: [
          {
            name: 'discardRunWhen',
            type: 'code',
            admin: {
              description: 'JSONata expression evaluated when a run finishes without a failed step. When it is true, the run is deleted instead of kept in the run history. Use it for workflows that often have nothing to do, such as a schedule that polls for work. Leave empty to keep every run. Failed runs, and runs with a failed step, are always kept. Example: $count(steps.find.output.docs) = 0',
              language: 'javascript',
            },
          },
        ],
      },
    ],
    hooks: {
      beforeChange: [
        // Reject a write whose steps do not each have their own slug, with an
        // error on the slug field of every offending step. This is a
        // collection hook rather than a field `validate` because Payload
        // skips field validation when a draft is saved, and a workflow saved
        // as a draft is still run when its trigger fires.
        //
        // An update that leaves the sequence of step slugs as it is stored
        // is not checked. Workflows saved before this check existed may hold
        // duplicate slugs; they stay editable (switching `enabled`, changing
        // a description) and only have to be fixed once their slugs change.
        ({ data, operation, originalDoc, req }) => {
          if (operation === 'update' && sameStepSlugs(originalDoc?.steps, data?.steps)) {
            return data
          }
          const errors = findStepSlugErrors(data?.steps)
          if (errors.length > 0) {
            throw new ValidationError({ collection: 'workflows', errors, req })
          }
          return data
        },
      ],
      afterChange: [
        // Update usage counts for triggers and steps. Every call passes
        // `req` so it joins the transaction that is saving the workflow: a
        // count on another connection would not see this workflow yet, and
        // on SQLite a second connection waits forever for the lock the open
        // transaction holds.
        async ({ doc, req }) => {
          const payload = req.payload

          // Update trigger usage counts
          if (doc.triggers && Array.isArray(doc.triggers)) {
            for (const triggerId of doc.triggers) {
              const id = typeof triggerId === 'object' ? triggerId.id : triggerId
              if (id) {
                try {
                  // Count workflows using this trigger
                  const count = await payload.count({
                    collection: 'workflows',
                    req,
                    where: {
                      triggers: { contains: id },
                    },
                  })
                  await payload.update({
                    collection: 'automation-triggers',
                    id,
                    data: { usageCount: count.totalDocs },
                    req,
                  })
                } catch {
                  // Ignore errors - trigger might have been deleted
                }
              }
            }
          }

          // Update step usage counts
          if (doc.steps && Array.isArray(doc.steps)) {
            const stepIds = new Set<string>()
            for (const workflowStep of doc.steps) {
              const stepId = typeof workflowStep.step === 'object'
                ? workflowStep.step.id
                : workflowStep.step
              if (stepId) stepIds.add(stepId)
            }

            for (const stepId of stepIds) {
              try {
                // Count workflows using this step
                const count = await payload.count({
                  collection: 'workflows',
                  req,
                  where: {
                    'steps.step': { equals: stepId },
                  },
                })
                await payload.update({
                  collection: 'automation-steps',
                  id: stepId,
                  data: { usageCount: count.totalDocs },
                  req,
                })
              } catch {
                // Ignore errors - step might have been deleted
              }
            }
          }

          return doc
        },
      ],
    },
    versions: {
      drafts: {
        autosave: false,
      },
      maxPerDoc: 10,
    },
  }
}
