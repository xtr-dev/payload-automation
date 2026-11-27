/**
 * The fields that identify a stored `workflow-runs.stepResults` row.
 * `slug` is missing on rows stored before the field existed.
 */
export interface StepResultIdentity {
  slug?: null | string
  stepName?: null | string
}

/**
 * Find the result of the step with `slug` in a run's `stepResults`.
 *
 * Rows that recorded their slug are matched on it. Rows stored before
 * `stepResults.slug` existed have no slug, so they are matched on their
 * `stepName` instead: `stepName` when given, otherwise `slug` itself.
 *
 * @example
 * ```typescript
 * import { findStepResult } from '@xtr-dev/payload-automation/server'
 *
 * const run = await payload.findByID({ collection: 'workflow-runs', id: runId })
 * const email = findStepResult(run.stepResults, 'send-welcome', 'Send welcome email')
 * console.log(email?.status, email?.output)
 * ```
 */
export function findStepResult<T extends StepResultIdentity>(
  stepResults: null | readonly T[] | undefined,
  slug: string,
  stepName: string = slug
): T | undefined {
  const results = stepResults ?? []
  return results.find((result) => result.slug === slug) ??
    results.find((result) => !result.slug && result.stepName === stepName)
}
