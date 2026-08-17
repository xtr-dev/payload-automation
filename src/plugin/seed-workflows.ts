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
  const existingStepsBySlug = new Map<string, AnyRecord>()
  for (const entry of existingSteps) {
    if (entry?.slug) {
      existingStepsBySlug.set(entry.slug, entry)
    }
  }
  for (const stepDef of seedWorkflow.steps) {
    const desiredSlug = stepDef.slug || slugify(stepDef.name)
    const existingEntry = existingStepsBySlug.get(desiredSlug)
    if (!existingEntry || !stepEntryMatches(existingEntry, stepDef, desiredSlug)) {
      return false
    }
  }

  return true
}

const idOf = (doc: AnyRecord | number | string | undefined | null): number | string | undefined =>
  doc && typeof doc === 'object' ? doc.id : (doc ?? undefined)

// Best-effort delete of a batch of docs created (and then abandoned) during a
// seed attempt, or of docs a successful update just superseded. Failures are
// logged, not thrown: cleanup is a courtesy, not something that should turn a
// successful create/update into a reported failure.
const deleteResources = async (
  payload: Payload,
  collection: 'automation-triggers' | 'automation-steps',
  ids: (number | string)[],
  logger: Logger
): Promise<void> => {
  for (const id of ids) {
    try {
      await payload.delete({ collection, id })
    } catch (error) {
      logger.warn(
        { collection, error: error instanceof Error ? error.message : 'Unknown error', id },
        `Failed to remove ${collection} document while seeding workflows`
      )
    }
  }
}

type ReconcileResult<TItems> = {
  items: TItems
  createdIds: (number | string)[]
  staleIds: (number | string)[]
}

// Reconciles the workflow's triggers against its seed definition one trigger
// at a time: a trigger whose stored fields already match its definition is
// left alone and reused by id, so an unrelated change elsewhere in the
// workflow does not invalidate workflow-runs history that references it via
// firedTrigger. Only triggers that actually differ (or are new) are created;
// their now-superseded predecessors are returned as staleIds for the caller
// to delete once it has safely pointed the workflow at the replacements.
//
// If a create call throws partway through, everything this call already
// created is deleted before rethrowing, so a failed attempt never leaves an
// orphan behind for the next restart to find.
const reconcileTriggers = async (
  payload: Payload,
  existingTriggers: AnyRecord[],
  seedWorkflow: SeedWorkflow,
  logger: Logger
): Promise<ReconcileResult<(number | string)[]>> => {
  const triggerIds: (number | string)[] = []
  const createdIds: (number | string)[] = []
  const staleIds: (number | string)[] = []

  try {
    for (let i = 0; i < seedWorkflow.triggers.length; i++) {
      const triggerDef = seedWorkflow.triggers[i]
      const desired = mapTriggerFields(triggerDef)
      const existingTrigger = existingTriggers[i]

      if (existingTrigger && typeof existingTrigger === 'object' && triggerMatches(existingTrigger, desired)) {
        triggerIds.push(existingTrigger.id)
        continue
      }

      const triggerName = `${seedWorkflow.name} - Trigger ${i + 1}`
      const trigger = await payload.create({
        collection: 'automation-triggers',
        data: { name: triggerName, ...desired },
      })
      logger.debug(`Created trigger: ${triggerName}`)
      triggerIds.push(trigger.id)
      createdIds.push(trigger.id)

      const staleId = idOf(existingTrigger)
      if (staleId !== undefined) {
        staleIds.push(staleId)
      }
    }

    for (let i = seedWorkflow.triggers.length; i < existingTriggers.length; i++) {
      const staleId = idOf(existingTriggers[i])
      if (staleId !== undefined) {
        staleIds.push(staleId)
      }
    }
  } catch (error) {
    await deleteResources(payload, 'automation-triggers', createdIds, logger)
    throw error
  }

  return { items: triggerIds, createdIds, staleIds }
}

// Reconciles steps the same way reconcileTriggers does, but matched by the
// stable per-step `slug` rather than array position: steps carry a slug for
// exactly this reason (f3d78a4, "step order can change without affecting
// references"), and matching by index instead means inserting, removing or
// reordering a step shifts every later step's stored entry off by one,
// recreating all of them even though their definitions never changed.
const reconcileSteps = async (
  payload: Payload,
  existingSteps: AnyRecord[],
  seedWorkflow: SeedWorkflow,
  logger: Logger
): Promise<ReconcileResult<WorkflowStepEntry[]>> => {
  const workflowSteps: WorkflowStepEntry[] = []
  const createdIds: (number | string)[] = []
  const staleIds: (number | string)[] = []

  const existingBySlug = new Map<string, AnyRecord>()
  for (const entry of existingSteps) {
    if (entry?.slug) {
      existingBySlug.set(entry.slug, entry)
    }
  }
  const reusedIds = new Set<number | string>()

  try {
    for (const stepDef of seedWorkflow.steps) {
      const desiredSlug = stepDef.slug || slugify(stepDef.name)
      const existingEntry = existingBySlug.get(desiredSlug)
      const desiredInput = stepDef.input || {}
      const dependencies = stepDef.dependencies?.map((dep) => ({ slug: dep }))

      if (existingEntry && stepEntryMatches(existingEntry, stepDef, desiredSlug)) {
        const stepId = idOf(existingEntry.step)
        if (stepId !== undefined) {
          reusedIds.add(stepId)
          workflowSteps.push({
            step: stepId,
            slug: desiredSlug,
            stepName: stepDef.name,
            inputOverrides: desiredInput,
            condition: stepDef.condition,
            dependencies,
          })
          continue
        }
      }

      const stepName = `${seedWorkflow.name} - ${stepDef.name}`
      const step = await payload.create({
        collection: 'automation-steps',
        data: {
          name: stepName,
          type: stepDef.type,
          config: desiredInput,
        },
      })
      logger.debug(`Created step: ${stepName}`)
      createdIds.push(step.id)

      workflowSteps.push({
        step: step.id,
        slug: desiredSlug,
        stepName: stepDef.name,
        inputOverrides: desiredInput,
        condition: stepDef.condition,
        dependencies,
      })
    }

    // Any existing step doc not reused above is either superseded by a
    // freshly created replacement (its slug still exists in the seed, but
    // content differed) or genuinely removed from the seed definition.
    // Either way it's stale.
    for (const entry of existingSteps) {
      const staleId = idOf(entry?.step)
      if (staleId !== undefined && !reusedIds.has(staleId)) {
        staleIds.push(staleId)
      }
    }
  } catch (error) {
    await deleteResources(payload, 'automation-steps', createdIds, logger)
    throw error
  }

  return { items: workflowSteps, createdIds, staleIds }
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

        let triggerResult: ReconcileResult<(number | string)[]> | undefined
        let stepResult: ReconcileResult<WorkflowStepEntry[]> | undefined

        try {
          triggerResult = await reconcileTriggers(payload, existing.triggers || [], seedWorkflow, logger)
          stepResult = await reconcileSteps(payload, existing.steps || [], seedWorkflow, logger)

          await payload.update({
            collection: 'workflows',
            id: existing.id,
            data: {
              name: seedWorkflow.name,
              description: seedWorkflow.description,
              triggers: triggerResult.items,
              steps: stepResult.items,
              readOnly: true,
            },
          })
        } catch (error) {
          // The workflow doc still points at whatever it pointed at before (either
          // untouched, because update() never ran or itself failed), so only the
          // freshly created replacements — not yet referenced anywhere — are
          // orphaned. Clean up just those rather than leaving them for the next
          // restart to find, and let the outer catch log the failure.
          await deleteResources(payload, 'automation-triggers', triggerResult?.createdIds || [], logger)
          await deleteResources(payload, 'automation-steps', stepResult?.createdIds || [], logger)
          throw error
        }

        // Only safe to remove the superseded docs now that the workflow has been
        // repointed at their replacements.
        await deleteResources(payload, 'automation-triggers', triggerResult.staleIds, logger)
        await deleteResources(payload, 'automation-steps', stepResult.staleIds, logger)

        logger.info(`Updated seeded workflow: ${seedWorkflow.name}`)
        continue
      }

      let triggerIds: (number | string)[] = []
      let workflowSteps: WorkflowStepEntry[] = []

      try {
        const triggerResult = await reconcileTriggers(payload, [], seedWorkflow, logger)
        const stepResult = await reconcileSteps(payload, [], seedWorkflow, logger)
        triggerIds = triggerResult.items
        workflowSteps = stepResult.items

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
      } catch (error) {
        // Nothing existed before this attempt, so every trigger/step created
        // here (reconcileTriggers/reconcileSteps already clean up their own
        // partial-loop failures) is orphaned if payload.create() itself fails.
        await deleteResources(payload, 'automation-triggers', triggerIds, logger)
        await deleteResources(
          payload,
          'automation-steps',
          workflowSteps.map((step) => step.step),
          logger
        )
        throw error
      }

      logger.info(`Seeded workflow: ${seedWorkflow.name}`)
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        `Failed to seed workflow '${seedWorkflow.name}'`
      )
    }
  }
}
