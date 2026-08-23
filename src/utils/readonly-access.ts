import type { Access, Payload, Where } from 'payload'

/**
 * A seeded, readOnly workflow is only as immutable as the trigger/step records it
 * points at. automation-triggers and automation-steps carry no readOnly field of
 * their own, so this derives the refusal from whether any currently-persisted
 * readOnly workflow still references the document - the same `where` shape the
 * usageCount afterChange hook in Workflow.ts already uses to count references the
 * other direction.
 *
 * Payload calls access without an `id` for bulk update/delete (a `where`-based
 * request rather than one for a single document), so a plain boolean here would
 * only guard the by-id routes. In that case a `Where` clause is returned instead,
 * excluding every id a readOnly workflow references, so bulk operations are
 * filtered the same way single-document ones are refused.
 */
export const refuseIfReferencedByReadOnlyWorkflow = (
  buildWhere: (id: number | string) => Where,
  collectReferencedIds: (workflow: Record<string, unknown>) => (number | string)[]
): Access => {
  return async ({ id, req }) => {
    if (id !== undefined && id !== null) {
      const referencingReadOnlyWorkflows = await req.payload.count({
        collection: 'workflows',
        where: {
          and: [buildWhere(id), { readOnly: { equals: true } }],
        },
      })

      return referencingReadOnlyWorkflows.totalDocs === 0
    }

    const referencedIds = await collectAllReferencedIds(req.payload, collectReferencedIds)
    if (referencedIds.length === 0) {
      return true
    }

    return { id: { not_in: referencedIds } }
  }
}

const collectAllReferencedIds = async (
  payload: Payload,
  collectReferencedIds: (workflow: Record<string, unknown>) => (number | string)[]
): Promise<(number | string)[]> => {
  const readOnlyWorkflows = await payload.find({
    collection: 'workflows',
    depth: 0,
    limit: 0,
    where: { readOnly: { equals: true } },
  })

  return readOnlyWorkflows.docs.flatMap((workflow) => collectReferencedIds(workflow as unknown as Record<string, unknown>))
}
