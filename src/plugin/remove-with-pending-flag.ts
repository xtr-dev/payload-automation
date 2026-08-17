import type { Payload } from 'payload'

export type RemoveWithPendingFlagOptions = {
  payload: Pick<Payload, 'delete' | 'update'>
  collection: 'automation-triggers' | 'automation-steps'
}

// reconcileStaleRecords derives staleIds from a workflow's OWN previous
// triggers/steps, which payload.update() has already repointed to the new
// ids by the time remove() runs here - so a payload.delete() failure that's
// only logged has no later staleIds list it could ever reappear on, and the
// record leaks forever. Flagging pendingDeletion:true on the record itself
// instead means it survives independently of that snapshot: a later
// reconcile pass can find it by querying for the flag directly and retry
// the deletion. On success there's nothing to clear - the flagged record is
// deleted along with its flag.
export const removeWithPendingFlag = (
  { payload, collection }: RemoveWithPendingFlagOptions
) => async (id: string | number): Promise<void> => {
  try {
    await payload.delete({
      collection,
      id,
      overrideAccess: true,
    })
  } catch (error) {
    await payload.update({
      collection,
      id,
      data: { pendingDeletion: true },
      overrideAccess: true,
    }).catch(() => {
      // best-effort marker; the delete error below is what actually matters
    })
    throw error
  }
}
