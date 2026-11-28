/**
 * Short description of an error thrown by a Payload write, for log entries
 * and for the `error` field of a workflow run.
 *
 * The message alone is often not enough: a Payload ValidationError only names
 * field labels, while its `data.errors` has the path and reason per field; a
 * database adapter error is the full SQL statement with its parameters, while
 * the reason (for example a foreign key violation) is in `cause`. The
 * statement is cut short because it would otherwise bury the reason.
 */
export const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return 'Unknown error'
  }
  const fieldErrors = (error as { data?: { errors?: unknown } }).data?.errors
  if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
    const fields = fieldErrors
      .map((fieldError: { message?: unknown; path?: unknown }) => {
        const path = typeof fieldError.path === 'string' ? fieldError.path : 'unknown field'
        const reason = typeof fieldError.message === 'string' ? fieldError.message : 'invalid'
        return `${path}: ${reason}`
      })
      .join('; ')
    return `${error.message} (${fields})`
  }
  if (error.cause instanceof Error && error.cause.message) {
    const statement = error.message.split('\n')[0]
    const shortened = statement.length > 200 ? `${statement.slice(0, 200)}...` : statement
    return `${error.cause.message} (${shortened})`
  }
  return error.message
}
