import { Cron } from 'croner'

/**
 * Builds the croner instance for a trigger's schedule without starting a
 * timer: croner only schedules work when it is given a callback.
 * Throws when the expression or the timezone is invalid.
 */
export const parseSchedule = (schedule: string, timezone?: null | string): Cron =>
  new Cron(schedule, timezone ? { timezone } : {})

/**
 * Throws a descriptive error when `schedule` is not a cron expression croner
 * understands, or `timezone` is not a valid IANA zone. Used to validate
 * triggers on save.
 */
export const assertValidSchedule = (schedule: string, timezone?: null | string): void => {
  let cron: Cron
  try {
    cron = parseSchedule(schedule, timezone)
  } catch (error) {
    throw new Error(
      `Invalid cron expression "${schedule}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    // croner only applies the timezone when computing a run, so an unknown
    // zone surfaces here rather than in the constructor.
    cron.nextRun()
  } catch (error) {
    throw new Error(
      `Invalid timezone "${timezone}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
