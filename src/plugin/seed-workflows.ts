import type { Payload } from 'payload'

import type { SeedWorkflow } from './config-types.js'

type Logger = Payload['logger']

type WorkflowStepEntry = {
  step: number | string
  slug: string
  stepName: string
  inputOverrides: Record<string, unknown>
  condition?: string
  dependencies?: Array<{ slug: string }>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

const slugify = (str: string): string =>
  str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Maps a seed trigger definition to the fields stored on an automation-triggers
// document, shared by trigger creation and by change detection so the two never drift apart.
const mapTriggerFields = (triggerDef: SeedWorkflow['triggers'][number]): Record<string, unknown> => {
  const fields: Record<string, unknown> = {
    type: triggerDef.type,
    condition: triggerDef.condition,
  }

  if (triggerDef.parameters) {
    if (triggerDef.type === 'collection-hook') {
      fields.collectionSlug = triggerDef.parameters.collectionSlug
      fields.hook = triggerDef.parameters.hook
    } else if (triggerDef.type === 'global-hook') {
      fields.globalSlug = triggerDef.parameters.globalSlug
      fields.hook = triggerDef.parameters.hook
    } else if (triggerDef.type === 'scheduled') {
      fields.schedule = triggerDef.parameters.schedule
    } else if (triggerDef.type === 'webhook') {
      fields.webhookPath = triggerDef.parameters.webhookPath
    }
  }

  return fields
}

const triggerMatches = (existingTrigger: AnyRecord, desired: Record<string, unknown>): boolean =>
  (['type', 'condition', 'collectionSlug', 'hook', 'globalSlug', 'schedule', 'webhookPath'] as const).every(
    (key) => (existingTrigger?.[key] ?? undefined) === (desired[key] ?? undefined)
  )

const stepEntryMatches = (
  existingEntry: AnyRecord,
  stepDef: SeedWorkflow['steps'][number],
  desiredSlug: string
): boolean => {
  const existingStepDoc = existingEntry?.step && typeof existingEntry.step === 'object' ? existingEntry.step : null
  const desiredInput = stepDef.input || {}
  const existingDependencySlugs = (existingEntry?.dependencies || []).map((dep: AnyRecord) => dep.slug)

  return (
    existingEntry?.slug === desiredSlug &&
    (existingEntry?.stepName ?? undefined) === stepDef.name &&
    JSON.stringify(existingEntry?.inputOverrides || {}) === JSON.stringify(desiredInput) &&
    (existingEntry?.condition ?? undefined) === (stepDef.condition ?? undefined) &&
    JSON.stringify(existingDependencySlugs) === JSON.stringify(stepDef.dependencies || []) &&
    existingStepDoc?.type === stepDef.type &&
    JSON.stringify(existingStepDoc?.config || {}) === JSON.stringify(desiredInput)
  )
}

// Compares a stored workflow (fetched with depth so triggers and step->step
// relationships are populated) against its seed definition. Returns false as
// soon as any compared field differs, which is also what decides whether a
// re-seed is needed at all.
const seedWorkflowMatches = (existing: AnyRecord, seedWorkflow: SeedWorkflow): boolean => {
  if (existing.name !== seedWorkflow.name) {
    return false
  }
  if ((existing.description ?? undefined) !== (seedWorkflow.description ?? undefined)) {
    return false
  }

  const existingTriggers: AnyRecord[] = existing.triggers || []
  if (existingTriggers.length !== seedWorkflow.triggers.length) {
    return false
  }
  for (let i = 0; i < seedWorkflow.triggers.length; i++) {
    const existingTrigger = existingTriggers[i]
    if (!existingTrigger || typeof existingTrigger !== 'object') {
      return false
    }
    if (!triggerMatches(existingTrigger, mapTriggerFields(seedWorkflow.triggers[i]))) {
      return false
    }
  }

  const existingSteps: AnyRecord[] = existing.steps || []
  if (existingSteps.length !== seedWorkflow.steps.length) {
    return false
  }
  for (let i = 0; i < seedWorkflow.steps.length; i++) {
    const stepDef = seedWorkflow.steps[i]
    const desiredSlug = stepDef.slug || slugify(stepDef.name)
    if (!stepEntryMatches(existingSteps[i], stepDef, desiredSlug)) {
      return false
    }
  }

  return true
}

const createTriggersForWorkflow = async (
  payload: Payload,
  seedWorkflow: SeedWorkflow,
  logger: Logger
): Promise<(number | string)[]> => {
  const triggerIds: (number | string)[] = []

  for (let i = 0; i < seedWorkflow.triggers.length; i++) {
    const triggerDef = seedWorkflow.triggers[i]
    const triggerName = `${seedWorkflow.name} - Trigger ${i + 1}`

    const trigger = await payload.create({
      collection: 'automation-triggers',
      data: {
        name: triggerName,
        ...mapTriggerFields(triggerDef),
      },
    })
    triggerIds.push(trigger.id)
    logger.debug(`Created trigger: ${triggerName}`)
  }

  return triggerIds
}

const createStepsForWorkflow = async (
  payload: Payload,
  seedWorkflow: SeedWorkflow,
  logger: Logger
): Promise<WorkflowStepEntry[]> => {
  const workflowSteps: WorkflowStepEntry[] = []

  for (const stepDef of seedWorkflow.steps) {
    const stepName = `${seedWorkflow.name} - ${stepDef.name}`
    const stepSlug = stepDef.slug || slugify(stepDef.name)

    const step = await payload.create({
      collection: 'automation-steps',
      data: {
        name: stepName,
        type: stepDef.type,
        config: stepDef.input || {},
      },
    })
    logger.debug(`Created step: ${stepName}`)

    workflowSteps.push({
      step: step.id,
      slug: stepSlug,
      stepName: stepDef.name,
      inputOverrides: stepDef.input || {},
      condition: stepDef.condition,
      dependencies: stepDef.dependencies?.map((dep) => ({ slug: dep })),
    })
  }

  return workflowSteps
}

// Best-effort cleanup of the trigger/step documents an update just replaced.
// These are private to the seeded workflow (named `${workflow.name} - ...`),
// so leaving them behind after every code change would accumulate orphans.
const deleteSupersededResources = async (payload: Payload, existing: AnyRecord, logger: Logger): Promise<void> => {
  const oldTriggerIds = ((existing.triggers || []) as AnyRecord[]).map((trigger) =>
    typeof trigger === 'object' ? trigger.id : trigger
  )
  const oldStepIds = ((existing.steps || []) as AnyRecord[]).map((entry) =>
    typeof entry.step === 'object' ? entry.step.id : entry.step
  )

  for (const id of oldTriggerIds) {
    try {
      await payload.delete({ collection: 'automation-triggers', id })
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error', triggerId: id },
        'Failed to remove superseded trigger while updating seeded workflow'
      )
    }
  }

  for (const id of oldStepIds) {
    try {
      await payload.delete({ collection: 'automation-steps', id })
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : 'Unknown error', stepId: id },
        'Failed to remove superseded step while updating seeded workflow'
      )
    }
  }
}

/**
 * Creates configured seed workflows that don't exist yet, and brings existing
 * ones back in line with their current code definition (name, description,
 * triggers, steps) instead of leaving a stale copy in place forever.
 */
export const seedWorkflows = async (
  payload: Payload,
  seedWorkflowDefs: SeedWorkflow[],
  logger: Logger
): Promise<void> => {
  logger.info(`Seeding ${seedWorkflowDefs.length} workflows...`)

  for (const seedWorkflow of seedWorkflowDefs) {
    try {
      // depth: 2 populates each trigger doc and each step's linked automation-steps
      // doc, both required to detect whether the stored workflow still matches.
      const existingWorkflow = await payload.find({
        collection: 'workflows',
        where: {
          slug: {
            equals: seedWorkflow.slug,
          },
        },
        depth: 2,
        limit: 1,
      })

      if (existingWorkflow.docs.length > 0) {
        const existing = existingWorkflow.docs[0] as AnyRecord

        if (seedWorkflowMatches(existing, seedWorkflow)) {
          logger.debug(`Workflow '${seedWorkflow.slug}' already exists and matches its definition, skipping seed`)
          continue
        }

        logger.info(`Updating seeded workflow '${seedWorkflow.slug}': ${seedWorkflow.name}`)

        const triggerIds = await createTriggersForWorkflow(payload, seedWorkflow, logger)
        const workflowSteps = await createStepsForWorkflow(payload, seedWorkflow, logger)

        await payload.update({
          collection: 'workflows',
          id: existing.id,
          data: {
            name: seedWorkflow.name,
            description: seedWorkflow.description,
            triggers: triggerIds,
            steps: workflowSteps,
            readOnly: true,
          },
        })

        await deleteSupersededResources(payload, existing, logger)

        logger.info(`Updated seeded workflow: ${seedWorkflow.name}`)
        continue
      }

      const triggerIds = await createTriggersForWorkflow(payload, seedWorkflow, logger)
      const workflowSteps = await createStepsForWorkflow(payload, seedWorkflow, logger)

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
      })

      logger.info(`Seeded workflow: ${seedWorkflow.name}`)
    } catch (error) {
      logger.error(`Failed to seed workflow '${seedWorkflow.name}':`, error)
    }
  }
}
