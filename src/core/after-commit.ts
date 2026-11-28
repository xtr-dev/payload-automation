import type { Payload, PayloadRequest } from 'payload'

import { isolateObjectProperty } from 'payload'

import { describeError } from '../utils/describe-error.js'
import { getSharedState } from './shared-state.js'

/**
 * Runs work once a database transaction has committed.
 *
 * A collection or global hook runs inside the transaction of the operation
 * that fired it (on Postgres always, on MongoDB when the server supports
 * transactions). A workflow started from there cannot run its steps right
 * away: every step is a Payload job, and Payload's job runner updates the job
 * in a transaction of its own, which cannot see a job row that the still open
 * transaction inserted. Steps would also act on a document that may yet be
 * rolled back. So the hook hands the workflow to `runAfterCommit`, and the
 * steps start when the document they react to is really stored.
 *
 * Payload has no "after commit" event, so the first call for a Payload
 * instance wraps the database adapter's `commitTransaction` and
 * `rollbackTransaction`:
 * - after a successful commit, the callbacks registered for that transaction
 *   run one after another, and `commitTransaction` only resolves when they
 *   are done. The operation that owns the transaction awaits its commit, so
 *   it still waits for the workflow, as it does without a transaction.
 * - a rollback, or a commit that throws, drops the callbacks: an operation
 *   that did not happen starts no workflow.
 */

type Callback = () => Promise<void>

type TransactionID = number | string

// Shared between all copies of the plugin in the process (see
// shared-state.ts): the adapter is wrapped once per Payload instance, and the
// wrapper must find callbacks registered by whichever copy ran the hook.
const callbacksByPayload = getSharedState(
  'afterCommitCallbacks',
  () => new WeakMap<Payload, Map<string, Callback[]>>()
)

// Marks an adapter whose transaction methods are already wrapped. A global
// symbol, so a second copy of the plugin does not wrap them again.
const WRAPPED = Symbol.for('@xtr-dev/payload-automation.afterCommit')

type TransactionalAdapter = {
  [WRAPPED]?: true
  commitTransaction: (id: Promise<TransactionID> | TransactionID) => Promise<void>
  rollbackTransaction: (id: Promise<TransactionID> | TransactionID) => Promise<void>
  /** Open transactions by id; both the drizzle and the mongoose adapter keep this. */
  sessions?: Record<string, { inTransaction?: () => boolean } | undefined>
}

/**
 * Whether the adapter still holds transaction `id` as open, as far as that
 * can be told. Both built-in adapters make `commitTransaction` return quietly
 * for a transaction that is gone (it was rolled back by a parallel operation
 * on the same request) or, on MongoDB, was aborted by the server. Neither is
 * a commit, so callbacks must not run. An adapter without a `sessions`
 * registry is assumed to commit whatever it is asked to.
 */
const isOpenTransaction = (db: TransactionalAdapter, id: string): boolean => {
  const sessions = db.sessions
  if (!sessions || typeof sessions !== 'object') {
    return true
  }
  const session = sessions[id]
  if (!session) {
    return false
  }
  return typeof session.inTransaction === 'function' ? session.inTransaction() : true
}

const takeCallbacks = (payload: Payload, id: unknown): Callback[] => {
  const pending = callbacksByPayload.get(payload)
  const key = String(id)
  const callbacks = pending?.get(key) ?? []
  pending?.delete(key)
  return callbacks
}

const wrapAdapter = (payload: Payload): void => {
  const db = payload.db as unknown as TransactionalAdapter
  if (db[WRAPPED]) {
    return
  }
  const commit = db.commitTransaction
  const rollback = db.rollbackTransaction

  db.commitTransaction = async function (incomingID) {
    const id = incomingID instanceof Promise ? await incomingID : incomingID
    const callbacks = takeCallbacks(payload, id)
    const wasOpen = callbacks.length > 0 && isOpenTransaction(db, String(id))
    // When this throws, the callbacks taken above are dropped with it.
    await commit.call(this, id)
    if (!wasOpen) {
      return
    }
    for (const callback of callbacks) {
      try {
        await callback()
      } catch (error) {
        // The transaction is committed; a failing callback must not make the
        // operation that owns it look failed.
        payload.logger.error(
          { error: describeError(error) },
          'Work deferred until after a database transaction committed has failed'
        )
      }
    }
  }

  db.rollbackTransaction = async function (incomingID) {
    const id = incomingID instanceof Promise ? await incomingID : incomingID
    takeCallbacks(payload, id)
    await rollback.call(this, id)
  }

  Object.defineProperty(db, WRAPPED, { enumerable: false, value: true })
}

/**
 * The id of the transaction `req` is part of, or undefined when it has none.
 * While Payload is still opening the transaction, `req.transactionID` is a
 * promise for the id.
 */
export const getTransactionID = async (req: PayloadRequest): Promise<TransactionID | undefined> => {
  const id = req.transactionID instanceof Promise ? await req.transactionID : req.transactionID
  return id ?? undefined
}

/**
 * Registers `callback` to run after transaction `transactionID` has
 * committed. It never runs when the transaction is rolled back.
 */
export const runAfterCommit = (payload: Payload, transactionID: TransactionID, callback: Callback): void => {
  wrapAdapter(payload)
  let pending = callbacksByPayload.get(payload)
  if (!pending) {
    pending = new Map()
    callbacksByPayload.set(payload, pending)
  }
  const key = String(transactionID)
  const callbacks = pending.get(key)
  if (callbacks) {
    callbacks.push(callback)
  } else {
    pending.set(key, [callback])
  }
}

/**
 * A view of `req` that is not part of any transaction, for work that runs
 * after the request's transaction has ended. Operations given this request
 * open and commit transactions of their own. Everything else (user, locale,
 * context, payload) is read from, and written to, the original request.
 */
export const withoutTransaction = (req: PayloadRequest): PayloadRequest => {
  const isolated = isolateObjectProperty(req, 'transactionID')
  delete isolated.transactionID
  return isolated
}
