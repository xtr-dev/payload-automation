import type { Payload } from 'payload'

type Logger = Payload['logger']

export type ReconcileStaleRecordsOptions = {
  kind: string
  isReferenced: (id: string | number) => Promise<boolean>
  remove: (id: string | number) => Promise<unknown>
  logger: Logger
}

// The reference check for each stale id is wrapped so a query failure on one
// id (a transient find() error) can't propagate out of the loop - that would
// both mislabel a successful reconcile as "Failed to seed workflow" and
// abandon every stale id still left in this loop, unchecked and undeleted.
// Treat a failed check like "referenced": leave it in place rather than risk
// deleting a record a run still points to.
export const reconcileStaleRecords = async (
  staleIds: Array<string | number>,
  { kind, isReferenced, remove, logger }: ReconcileStaleRecordsOptions
): Promise<void> => {
  for (const staleId of staleIds) {
    let referenced: boolean
    try {
      referenced = await isReferenced(staleId)
    } catch (error) {
      logger.warn(`Could not determine whether stale ${kind} ${String(staleId)} is referenced by a run; leaving it in place: ${String(error)}`)
      continue
    }
    if (referenced) {
      logger.debug(`Preserving stale ${kind} ${String(staleId)}: referenced by an existing workflow run`)
      continue
    }
    await remove(staleId).catch((error) => {
      logger.warn(`Could not remove stale ${kind} ${String(staleId)}: ${String(error)}`)
    })
  }
}
