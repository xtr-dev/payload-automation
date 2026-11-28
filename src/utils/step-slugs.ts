/**
 * Checks that every step of a workflow has its own, non-empty slug.
 *
 * The slug is how the rest of the plugin identifies a step: `steps.<slug>` in
 * expressions, `dependencies`, the stored step results of a run. Two steps
 * with one slug cannot both be addressed: the second one's output replaces
 * the first's in the expression context, and the executor orders dependents
 * as if only one of them existed.
 *
 * Returns one error per offending step, keyed by the path of its `slug` field
 * (`steps.<index>.slug`), so the caller can report each on the field the user
 * has to change. Slugs are compared exactly as stored; nothing is trimmed or
 * lower-cased, because expressions and dependencies match them exactly too.
 */
export const findStepSlugErrors = (steps: unknown): Array<{ message: string; path: string }> => {
  if (!Array.isArray(steps)) {
    return []
  }
  const errors: Array<{ message: string; path: string }> = []
  // Position (1-based, as the admin panel numbers array rows) of the first
  // step that uses each slug.
  const firstUse = new Map<string, number>()

  steps.forEach((step: unknown, index) => {
    const slug = (step as { slug?: unknown } | null | undefined)?.slug
    const path = `steps.${index}.slug`
    if (typeof slug !== 'string' || slug.trim() === '') {
      errors.push({
        message: 'Every step needs a slug. It is how expressions (steps.<slug>) and dependencies refer to the step.',
        path,
      })
      return
    }
    const earlier = firstUse.get(slug)
    if (earlier !== undefined) {
      errors.push({
        message: `The slug "${slug}" is already used by step ${earlier} of this workflow. Step slugs must be unique within a workflow; give this step a different slug.`,
        path,
      })
      return
    }
    firstUse.set(slug, index + 1)
  })

  return errors
}

/**
 * Whether two `steps` arrays hold the same slugs in the same order. Used to
 * tell a write that changes the step slugs of a workflow from one that only
 * carries the stored steps along.
 */
export const sameStepSlugs = (stored: unknown, incoming: unknown): boolean => {
  const slugsOf = (steps: unknown): unknown[] =>
    Array.isArray(steps) ? steps.map((step: unknown) => (step as { slug?: unknown } | null | undefined)?.slug) : []
  const storedSlugs = slugsOf(stored)
  const incomingSlugs = slugsOf(incoming)
  return storedSlugs.length === incomingSlugs.length &&
    storedSlugs.every((slug, index) => slug === incomingSlugs[index])
}
