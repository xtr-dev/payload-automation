import type { Payload } from 'payload'

import type { SeedWorkflow } from './config-types.js'

import { describeError } from '../utils/describe-error.js'
import { hashWebhookSecret, normalizeWebhookPath } from '../utils/webhook.js'
import { clearHookTriggerCache } from './trigger-cache.js'

type Logger = Payload['logger']

type WorkflowStepEntry = {
  step: number | string
  slug: string
  stepName: string
  inputOverrides: Record<string, unknown>
  condition?: string
  dependencies?: Array<{ slug: string }>
}

// Optional workflow settings a seed definition may declare, stored under the
// same names on the workflows document.
const workflowSettingKeys = ['errorHandling', 'maxRetries', 'retryDelay', 'timeout', 'discardRunWhen'] as const

// Optional retry settings a seed step may declare, stored under the same
// names on the step's automation-steps document.
const stepRetryKeys = ['retryOnFailure', 'maxRetries', 'retryDelay'] as const

// Picks the optional settings a seed definition actually declares. Settings
// left out are not managed by the seeder: they are neither written nor
// compared, so the collection default applies on create and a value changed
// on the stored document afterwards is kept.
const declaredSettings = (
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> => {
  const declared: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) {
      declared[key] = source[key]
    }
  }
  return declared
}

const declaredSettingsMatch = (
  existing: Record<string, unknown> | null | undefined,
  declared: Record<string, unknown>
): boolean => Object.entries(declared).every(([key, value]) => (existing?.[key] ?? undefined) === value)

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
      fields.timezone = triggerDef.parameters.timezone
    } else if (triggerDef.type === 'webhook') {
      fields.webhookPath = triggerDef.parameters.webhookPath
      fields.webhookSecret = triggerDef.parameters.webhookSecret
    }
  }

  return fields
}

// The automation-triggers collection normalizes some values when it saves them
// (Triggers.ts beforeChange): the timezone is trimmed and stored as null when
// empty, the webhook path loses its surrounding slashes, and the webhook secret
// is stored only as a SHA-256 hash. The desired fields are put through the same
// normalization here, so a stored trigger is compared with what saving its
// definition would produce and an unchanged definition is not seen as a change
// on every startup.
const storedTriggerFields = (desired: Record<string, unknown>): Record<string, unknown> => {
  const { webhookSecret, ...stored } = desired

  if (typeof stored.timezone === 'string') {
    stored.timezone = stored.timezone.trim() || undefined
  }
  if (typeof stored.webhookPath === 'string') {
    stored.webhookPath = normalizeWebhookPath(stored.webhookPath)
  }
  if (typeof webhookSecret === 'string' && webhookSecret.length > 0) {
    stored.webhookSecretHash = hashWebhookSecret(webhookSecret)
  }

  return stored
}

const comparedTriggerFields = [
  'type',
  'condition',
  'collectionSlug',
  'hook',
  'globalSlug',
  'schedule',
  'timezone',
  'webhookPath',
  'webhookSecretHash',
] as const

// `existingTrigger` must have been read with showHiddenFields, or its
// webhookSecretHash is missing and every webhook trigger looks changed.
const triggerMatches = (existingTrigger: AnyRecord, desired: Record<string, unknown>): boolean => {
  const stored = storedTriggerFields(desired)
  return comparedTriggerFields.every(
    (key) => (existingTrigger?.[key] ?? undefined) === (stored[key] ?? undefined)
  )
}

// Structural comparison of JSON values that ignores object key order. Step
// inputs are stored in JSON columns, and some databases (Postgres jsonb) return
// object keys in a different order than they were written, so comparing
// JSON.stringify output would report a change on every startup there.
const jsonEquals = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonEquals(item, b[index]))
    )
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord).filter((key) => aRecord[key] !== undefined)
  const bKeys = Object.keys(bRecord).filter((key) => bRecord[key] !== undefined)
  return aKeys.length === bKeys.length && aKeys.every((key) => jsonEquals(aRecord[key], bRecord[key]))
}

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
    jsonEquals(existingEntry?.inputOverrides || {}, desiredInput) &&
    (existingEntry?.condition ?? undefined) === (stepDef.condition ?? undefined) &&
    jsonEquals(existingDependencySlugs, stepDef.dependencies || []) &&
    existingStepDoc?.type === stepDef.type &&
    jsonEquals(existingStepDoc?.config || {}, desiredInput) &&
    declaredSettingsMatch(existingStepDoc, declaredSettings(stepDef, stepRetryKeys))
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
  if (!declaredSettingsMatch(existing, declaredSettings(seedWorkflow, workflowSettingKeys))) {
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
  // Compared positionally, not just by slug: `steps` is a stored order, and a
  // pure reorder in the seed definition (same slugs, same content, swapped
  // positions) must be seen as a mismatch so it reaches reconcileSteps and
  // gets written, rather than passing because every slug still matches
  // *something* in the existing array.
  for (let i = 0; i < seedWorkflow.steps.length; i++) {
    const stepDef = seedWorkflow.steps[i]
    const desiredSlug = stepDef.slug || slugify(stepDef.name)
    const existingEntry = existingSteps[i]
    if (!existingEntry || existingEntry.slug !== desiredSlug || !stepEntryMatches(existingEntry, stepDef, desiredSlug)) {
      return false
    }
  }

  return true
}

// Throws when the steps of a seed definition do not each get their own
// non-empty slug. A step's slug defaults to its slugified name, so two steps
// named "Send email" and "Send Email!" collide without either declaring one.
//
// The slug is how the rest of the plugin identifies a step: `steps.<slug>` in
// expressions, `dependencies`, and the seeder's own matching of stored steps.
// With a shared slug the seeder would link both entries to one
// automation-steps document and the second step's output would overwrite the
// first's. Picking a different slug for one of them here would silently
// change what `steps.<slug>` refers to, so the definition is rejected instead.
const assertUniqueStepSlugs = (seedWorkflow: SeedWorkflow): void => {
  const nameBySlug = new Map<string, string>()
  for (const stepDef of seedWorkflow.steps) {
    const slug = stepDef.slug || slugify(stepDef.name)
    if (!slug) {
      throw new Error(
        `Step "${stepDef.name}" has no usable slug: its name contains no letters or digits. Give the step an explicit \`slug\`.`
      )
    }
    const other = nameBySlug.get(slug)
    if (other !== undefined) {
      throw new Error(
        `Steps "${other}" and "${stepDef.name}" both resolve to the slug "${slug}". ` +
        'Step slugs must be unique within a workflow; give one of the steps an explicit, different `slug`.'
      )
    }
    nameBySlug.set(slug, stepDef.name)
  }
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

// Deletes trigger/step docs that a successful workflow update no longer
// references. automation-triggers and automation-steps are shared libraries:
// a workflow made in the admin panel can point at a doc the seeder created, so
// a doc another workflow still references is kept.
const deleteUnreferenced = async (
  payload: Payload,
  collection: 'automation-triggers' | 'automation-steps',
  ids: (number | string)[],
  logger: Logger
): Promise<void> => {
  const unreferenced: (number | string)[] = []
  for (const id of ids) {
    try {
      const { totalDocs } = await payload.count({
        collection: 'workflows',
        where: collection === 'automation-triggers' ? { triggers: { contains: id } } : { 'steps.step': { equals: id } },
      })
      if (totalDocs === 0) {
        unreferenced.push(id)
      }
    } catch (error) {
      logger.warn(
        { collection, error: error instanceof Error ? error.message : 'Unknown error', id },
        `Failed to check whether a ${collection} document is still in use while seeding workflows`
      )
    }
  }
  await deleteResources(payload, collection, unreferenced, logger)
}

type ReconcileResult<TItems> = {
  items: TItems
  createdIds: (number | string)[]
  staleIds: (number | string)[]
  /**
   * Puts documents that were changed in place back as they were. Called when
   * a later part of the same seed attempt fails, so the stored workflow keeps
   * the triggers it had.
   */
  restore?: () => Promise<void>
}

// The fields of a stored trigger that an in-place update may change, read
// before the update so they can be written back if the seed attempt fails.
// `lastFiredAt` is included because the collection resets it when a schedule
// changes; `webhookSecretHash` because only the hash of a secret is stored.
const restorableTriggerFields = [
  'condition',
  'collectionSlug',
  'hook',
  'globalSlug',
  'schedule',
  'timezone',
  'lastFiredAt',
  'webhookPath',
  'webhookSecretHash',
] as const

// Whether a workflow other than `workflowId` references trigger `triggerId`.
// automation-triggers is a shared library: a workflow made in the admin panel
// can point at a trigger the seeder created. Changing such a trigger in place
// would silently change when that other workflow runs. When the lookup fails
// the trigger counts as shared, which only costs a replacement document.
const isTriggerShared = async (
  payload: Payload,
  triggerId: number | string,
  workflowId: number | string,
  logger: Logger
): Promise<boolean> => {
  try {
    const { totalDocs } = await payload.count({
      collection: 'workflows',
      where: {
        and: [
          { triggers: { contains: triggerId } },
          { id: { not_equals: workflowId } },
        ],
      },
    })
    return totalDocs > 0
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : 'Unknown error', triggerId },
      'Failed to check whether a trigger is used by another workflow while seeding workflows'
    )
    return true
  }
}

// Pairs each trigger of a seed definition with the stored trigger document it
// can keep, by content rather than by position: a trigger whose stored fields
// match a definition is reused wherever it now sits in the list. Matching by
// position alone would treat a pure reorder (or a trigger inserted at the
// front) as "every trigger changed" and recreate them all, leaving the
// `firedTrigger` of every earlier workflow run pointing at a deleted document.
//
// A trigger still at its old position is paired first, so two identical
// triggers keep their own documents. Each stored trigger is paired at most
// once. The result has one entry per seed trigger: the stored document to
// reuse, or undefined when a new one has to be created.
const pairTriggers = (
  existingTriggers: AnyRecord[],
  desiredFields: Record<string, unknown>[]
): (AnyRecord | undefined)[] => {
  const paired: (AnyRecord | undefined)[] = desiredFields.map(() => undefined)
  const taken = new Set<number>()
  const isUsable = (index: number, desired: Record<string, unknown>): boolean => {
    const candidate = existingTriggers[index]
    return !taken.has(index) && Boolean(candidate) && typeof candidate === 'object' && triggerMatches(candidate, desired)
  }

  desiredFields.forEach((desired, i) => {
    if (isUsable(i, desired)) {
      paired[i] = existingTriggers[i]
      taken.add(i)
    }
  })
  desiredFields.forEach((desired, i) => {
    if (paired[i]) {
      return
    }
    const match = existingTriggers.findIndex((_, index) => isUsable(index, desired))
    if (match !== -1) {
      paired[i] = existingTriggers[match]
      taken.add(match)
    }
  })

  return paired
}

// Reconciles the workflow's triggers against its seed definition, keeping
// the stored trigger documents wherever possible, because workflow runs
// reference them through `firedTrigger` and a scheduled trigger carries its
// `lastFiredAt`:
//
// 1. A stored trigger whose fields match a definition is reused as it is (see
//    pairTriggers), so neither an unrelated change elsewhere in the workflow
//    nor a reorder touches it.
// 2. A definition without a match takes over a stored trigger that no
//    definition matched, when that trigger has the same type and no other
//    workflow uses it: the document is updated in place and keeps its id.
//    The trigger at the same position is preferred. A trigger of another
//    type is never converted; the fields that would carry over (a schedule's
//    `lastFiredAt`, say) mean nothing for a different kind of trigger.
// 3. Otherwise a new trigger is created.
//
// The stored triggers no definition uses any more are returned as staleIds
// for the caller to delete once it has safely pointed the workflow at the
// replacements.
//
// If a call throws partway through, everything this call already created is
// deleted and everything it updated in place is restored before rethrowing,
// so a failed attempt leaves neither an orphan nor a half-applied trigger.
// The caller does the same through `createdIds` and `restore` when a later
// step of the attempt fails.
const reconcileTriggers = async (
  payload: Payload,
  existingTriggers: AnyRecord[],
  seedWorkflow: SeedWorkflow,
  logger: Logger,
  workflowId?: number | string
): Promise<ReconcileResult<(number | string)[]>> => {
  const triggerIds: (number | string)[] = []
  const createdIds: (number | string)[] = []
  const staleIds: (number | string)[] = []
  const updatedInPlace: { id: number | string; previous: Record<string, unknown> }[] = []

  const desiredFields = seedWorkflow.triggers.map(mapTriggerFields)
  const reusable = pairTriggers(existingTriggers, desiredFields)
  const reusedIds = new Set<number | string>()
  for (const reused of reusable) {
    if (reused) {
      reusedIds.add(reused.id)
    }
  }

  const restore = async (): Promise<void> => {
    for (const { id, previous } of updatedInPlace) {
      try {
        // Written through the database adapter: the collection's hooks would
        // hash the stored secret hash again and move `lastFiredAt`.
        await payload.db.updateOne({ collection: 'automation-triggers', id, data: previous, returning: false })
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : 'Unknown error', id },
          'Failed to restore a trigger that was updated in place while seeding workflows'
        )
      }
    }
    if (updatedInPlace.length > 0) {
      // The adapter write runs no hooks, so the hook handlers' cached trigger
      // list has to be dropped by hand.
      clearHookTriggerCache(payload)
    }
  }

  // The stored trigger a changed definition at position `index` can take
  // over, if any (rule 2 above).
  const findUpdatable = async (index: number, desired: Record<string, unknown>): Promise<AnyRecord | undefined> => {
    if (workflowId === undefined) {
      return undefined
    }
    const isCandidate = (candidate: AnyRecord | undefined): candidate is AnyRecord =>
      Boolean(candidate) &&
      typeof candidate === 'object' &&
      candidate.id !== undefined &&
      !reusedIds.has(candidate.id) &&
      candidate.type === desired.type
    const candidates = [
      existingTriggers[index],
      ...existingTriggers.filter((_, position) => position !== index),
    ].filter(isCandidate)
    for (const candidate of candidates) {
      if (!(await isTriggerShared(payload, candidate.id, workflowId, logger))) {
        return candidate
      }
    }
    return undefined
  }

  try {
    for (let i = 0; i < desiredFields.length; i++) {
      const reused = reusable[i]
      if (reused) {
        triggerIds.push(reused.id)
        continue
      }

      const updatable = await findUpdatable(i, desiredFields[i])
      if (updatable) {
        const previous: Record<string, unknown> = {}
        const data: Record<string, unknown> = {}
        for (const key of restorableTriggerFields) {
          previous[key] = updatable[key] ?? null
        }
        // A field the definition no longer sets (a removed condition or
        // timezone) has to be cleared, not left at its stored value.
        for (const key of ['condition', 'collectionSlug', 'hook', 'globalSlug', 'schedule', 'timezone', 'webhookPath']) {
          data[key] = desiredFields[i][key] ?? null
        }
        if (desiredFields[i].webhookSecret !== undefined) {
          data.webhookSecret = desiredFields[i].webhookSecret
        }
        reusedIds.add(updatable.id)
        // Registered before the write, so a write that fails halfway is
        // restored as well.
        updatedInPlace.push({ id: updatable.id, previous })
        await payload.update({ collection: 'automation-triggers', id: updatable.id, data })
        logger.debug(`Updated trigger in place: ${String(updatable.name ?? updatable.id)}`)
        triggerIds.push(updatable.id)
        continue
      }

      const triggerName = `${seedWorkflow.name} - Trigger ${i + 1}`
      const trigger = await payload.create({
        collection: 'automation-triggers',
        data: { name: triggerName, ...desiredFields[i] },
      })
      logger.debug(`Created trigger: ${triggerName}`)
      triggerIds.push(trigger.id)
      createdIds.push(trigger.id)
    }

    for (const existingTrigger of existingTriggers) {
      const staleId = idOf(existingTrigger)
      if (staleId !== undefined && !reusedIds.has(staleId)) {
        staleIds.push(staleId)
      }
    }
  } catch (error) {
    await deleteResources(payload, 'automation-triggers', createdIds, logger)
    await restore()
    throw error
  }

  return { items: triggerIds, createdIds, restore, staleIds }
}

// Reconciles steps the same way reconcileTriggers does, but matched by the
// stable per-step `slug` rather than array position: steps carry a slug for
// exactly this reason (step order can change without affecting references),
// and matching by index instead means inserting, removing or reordering a
// step shifts every later step's stored entry off by one,
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

      // A replacement for an existing step keeps that step's retry settings
      // where the definition does not declare them, so replacing the document
      // for an unrelated change (new input, new type) does not silently reset
      // settings the seeder does not manage.
      const replacedStepDoc =
        existingEntry?.step && typeof existingEntry.step === 'object' ? existingEntry.step : {}

      const stepName = `${seedWorkflow.name} - ${stepDef.name}`
      const step = await payload.create({
        collection: 'automation-steps',
        data: {
          name: stepName,
          type: stepDef.type,
          config: desiredInput,
          ...declaredSettings(replacedStepDoc, stepRetryKeys),
          ...declaredSettings(stepDef, stepRetryKeys),
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
 * triggers, steps, and the optional settings the definition declares)
 * instead of leaving a stale copy in place forever.
 */
export const seedWorkflows = async (
  payload: Payload,
  seedWorkflowDefs: SeedWorkflow[],
  logger: Logger
): Promise<void> => {
  logger.info(`Seeding ${seedWorkflowDefs.length} workflows...`)

  for (const seedWorkflow of seedWorkflowDefs) {
    try {
      // Before anything is read or written, so an invalid definition leaves
      // a workflow seeded from an earlier, valid definition as it was.
      assertUniqueStepSlugs(seedWorkflow)

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
        // Needed to compare a webhook trigger's stored secret hash, a hidden field.
        showHiddenFields: true,
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
          triggerResult = await reconcileTriggers(payload, existing.triggers || [], seedWorkflow, logger, existing.id)
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
              ...declaredSettings(seedWorkflow, workflowSettingKeys),
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
          // Triggers that were updated in place are still referenced by the
          // workflow, so they get their previous fields back.
          await triggerResult?.restore?.()
          throw error
        }

        // Only safe to remove the superseded docs now that the workflow has been
        // repointed at their replacements.
        await deleteUnreferenced(payload, 'automation-triggers', triggerResult.staleIds, logger)
        await deleteUnreferenced(payload, 'automation-steps', stepResult.staleIds, logger)

        logger.info(`Updated seeded workflow: ${seedWorkflow.name}`)
        continue
      }

      let triggerIds: (number | string)[] = []
      let workflowSteps: WorkflowStepEntry[] = []

      try {
        // Assigned one at a time, so the catch below still knows about the
        // triggers when creating the steps is what fails.
        triggerIds = (await reconcileTriggers(payload, [], seedWorkflow, logger)).items
        workflowSteps = (await reconcileSteps(payload, [], seedWorkflow, logger)).items

        await payload.create({
          collection: 'workflows',
          data: {
            slug: seedWorkflow.slug,
            name: seedWorkflow.name,
            description: seedWorkflow.description,
            triggers: triggerIds,
            steps: workflowSteps,
            readOnly: true,
            ...declaredSettings(seedWorkflow, workflowSettingKeys),
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
        {
          workflowName: seedWorkflow.name,
          workflowSlug: seedWorkflow.slug,
          // Includes the per-field errors of a ValidationError, whose message
          // alone only says that "the following field is invalid".
          error: error instanceof Error ? describeError(error) : String(error),
        },
        'Failed to seed workflow',
      )
    }
  }
}
