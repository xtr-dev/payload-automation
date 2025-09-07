import type {Config, Payload, TaskConfig} from 'payload'

import cron from 'node-cron'

import {type PayloadWorkflow, WorkflowExecutor} from '../core/workflow-executor.js'
import {getConfigLogger} from './logger.js'

/**
 * Generate dynamic cron tasks for all workflows with cron triggers
 * This is called at config time to register all scheduled tasks
 */
export function generateCronTasks(config: Config): void {
  const logger = getConfigLogger()

  // Note: We can't query the database at config time, so we'll need a different approach
  // We'll create a single task that handles all cron-triggered workflows
  const cronTask: TaskConfig = {
    slug: 'workflow-cron-executor',
    handler: async ({ input, req }) => {
      const { cronExpression, timezone, workflowId } = input as {
        cronExpression?: string
        timezone?: string
        workflowId: string
      }

      const logger = req.payload.logger.child({ plugin: '@xtr-dev/payload-automation' })

      try {
        // Get the workflow
        const workflow = await req.payload.findByID({
          id: workflowId,
          collection: 'workflows',
          depth: 2,
          req
        })

        if (!workflow) {
          throw new Error(`Workflow ${workflowId} not found`)
        }

        // Create execution context for cron trigger
        const context = {
          steps: {},
          trigger: {
            type: 'cron',
            req,
            triggeredAt: new Date().toISOString()
          }
        }

        // Create executor
        const executor = new WorkflowExecutor(req.payload, logger)

        // Find the matching cron trigger and check its condition if present
        const triggers = workflow.triggers as Array<{
          condition?: string
          parameters?: {
            cronExpression?: string
            timezone?: string
            [key: string]: any
          }
          type: string
        }>

        const matchingTrigger = triggers?.find(trigger =>
          trigger.type === 'cron-trigger' &&
          trigger.parameters?.cronExpression === cronExpression
        )

        // Check trigger condition if present
        if (matchingTrigger?.condition) {
          const conditionMet = executor.evaluateCondition(matchingTrigger.condition, context)

          if (!conditionMet) {
            logger.info({
              condition: matchingTrigger.condition,
              cronExpression,
              workflowId,
              workflowName: workflow.name
            }, 'Cron trigger condition not met, skipping workflow execution')

            // Re-queue for next execution but don't run workflow
            if (cronExpression) {
              void requeueCronJob(workflowId, cronExpression, timezone, req.payload, logger)
            }

            return {
              output: {
                executedAt: new Date().toISOString(),
                reason: 'Condition not met',
                status: 'skipped',
                workflowId
              },
              state: 'succeeded'
            }
          }

          logger.info({
            condition: matchingTrigger.condition,
            cronExpression,
            workflowId,
            workflowName: workflow.name
          }, 'Cron trigger condition met')
        }

        // Execute the workflow
        await executor.execute(workflow as PayloadWorkflow, context, req)

        // Re-queue the job for the next scheduled execution if cronExpression is provided
        if (cronExpression) {
          void requeueCronJob(workflowId, cronExpression, timezone, req.payload, logger)
        }

        return {
          output: {
            executedAt: new Date().toISOString(),
            status: 'completed',
            workflowId
          },
          state: 'succeeded'
        }
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : 'Unknown error',
          workflowId
        }, 'Cron job execution failed')

        // Re-queue even on failure to ensure continuity (unless it's a validation error)
        if (cronExpression && !(error instanceof Error && error.message.includes('Invalid cron'))) {
          void requeueCronJob(workflowId, cronExpression, timezone, req.payload, logger)
            .catch((requeueError) => {
              logger.error({
                error: requeueError instanceof Error ? requeueError.message : 'Unknown error',
                workflowId
              }, 'Failed to re-queue cron job after execution failure')
            })
        }

        return {
          output: {
            error: error instanceof Error ? error.message : 'Unknown error',
            workflowId
          },
          state: 'failed'
        }
      }
    }
  }

  // Add the cron task to config if not already present
  if (!config.jobs) {
    config.jobs = { tasks: [] }
  }

  if (!config.jobs.tasks) {
    config.jobs.tasks = []
  }

  if (!config.jobs.tasks.find(task => task.slug === cronTask.slug)) {
    logger.debug(`Registering cron executor task: ${cronTask.slug}`)
    config.jobs.tasks.push(cronTask)
  } else {
    logger.debug(`Cron executor task ${cronTask.slug} already registered, skipping`)
  }
}

/**
 * Register cron jobs for workflows with cron triggers
 * This is called at runtime after PayloadCMS is initialized
 */
export async function registerCronJobs(payload: Payload, logger: Payload['logger']): Promise<void> {
  try {
    // Find all workflows with cron triggers
    const workflows = await payload.find({
      collection: 'workflows',
      depth: 0,
      limit: 1000,
      where: {
        'triggers.type': {
          equals: 'cron-trigger'
        }
      }
    })

    logger.info(`Found ${workflows.docs.length} workflows with cron triggers`)

    for (const workflow of workflows.docs) {
      const triggers = workflow.triggers as Array<{
        parameters?: {
          cronExpression?: string
          timezone?: string
          [key: string]: any
        }
        type: string
      }>

      // Find all cron triggers for this workflow
      const cronTriggers = triggers?.filter(t => t.type === 'cron-trigger') || []

      for (const trigger of cronTriggers) {
        if (trigger.parameters?.cronExpression) {
          try {
            // Validate cron expression before queueing
            if (!validateCronExpression(trigger.parameters.cronExpression)) {
              logger.error({
                cronExpression: trigger.parameters.cronExpression,
                workflowId: workflow.id,
                workflowName: workflow.name
              }, 'Invalid cron expression format')
              continue
            }

            // Validate timezone if provided
            if (trigger.parameters?.timezone) {
              try {
                // Test if timezone is valid by trying to create a date with it
                new Intl.DateTimeFormat('en', { timeZone: trigger.parameters.timezone })
              } catch {
                logger.error({
                  timezone: trigger.parameters.timezone,
                  workflowId: workflow.id,
                  workflowName: workflow.name
                }, 'Invalid timezone specified')
                continue
              }
            }

            // Calculate next execution time
            const nextExecution = getNextCronTime(trigger.parameters.cronExpression, trigger.parameters?.timezone)

            // Queue the job
            await payload.jobs.queue({
              input: { cronExpression: trigger.parameters.cronExpression, timezone: trigger.parameters?.timezone, workflowId: workflow.id },
              task: 'workflow-cron-executor',
              waitUntil: nextExecution
            })

            logger.info({
              cronExpression: trigger.parameters.cronExpression,
              nextExecution: nextExecution.toISOString(),
              timezone: trigger.parameters?.timezone || 'UTC',
              workflowId: workflow.id,
              workflowName: workflow.name
            }, 'Queued initial cron job for workflow')
          } catch (error) {
            logger.error({
              cronExpression: trigger.parameters.cronExpression,
              error: error instanceof Error ? error.message : 'Unknown error',
              timezone: trigger.parameters?.timezone,
              workflowId: workflow.id,
              workflowName: workflow.name
            }, 'Failed to queue cron job')
          }
        } else {
          logger.warn({
            workflowId: workflow.id,
            workflowName: workflow.name
          }, 'Cron trigger found but no cron expression specified')
        }
      }
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 'Failed to register cron jobs')
  }
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(cronExpression: string): boolean {
  return cron.validate(cronExpression)
}

/**
 * Calculate the next time a cron expression should run
 */
function getNextCronTime(cronExpression: string, timezone?: string): Date {
  if (!validateCronExpression(cronExpression)) {
    throw new Error(`Invalid cron expression: ${cronExpression}`)
  }

  const now = new Date()
  const options: { timezone?: string } = timezone ? { timezone } : {}

  // Create a task to find the next execution time
  const task = cron.schedule(cronExpression, () => {}, {
    ...options
  })

  // Parse cron expression parts
  const cronParts = cronExpression.trim().split(/\s+/)
  if (cronParts.length !== 5) {
    void task.destroy()
    throw new Error(`Invalid cron format: ${cronExpression}. Expected 5 parts.`)
  }

  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = cronParts

  // Calculate next execution with proper lookahead for any schedule frequency
  // Start from next minute and look ahead systematically
  let testTime = new Date(now.getTime() + 60 * 1000) // Start 1 minute from now
  testTime.setSeconds(0, 0) // Reset seconds and milliseconds

  // Maximum iterations to prevent infinite loops (covers ~2 years)
  const maxIterations = 2 * 365 * 24 * 60 // 2 years worth of minutes
  let iterations = 0

  while (iterations < maxIterations) {
    const minute = testTime.getMinutes()
    const hour = testTime.getHours()
    const dayOfMonth = testTime.getDate()
    const month = testTime.getMonth() + 1
    const dayOfWeek = testTime.getDay()

    if (matchesCronPart(minute, minutePart) &&
        matchesCronPart(hour, hourPart) &&
        matchesCronPart(dayOfMonth, dayPart) &&
        matchesCronPart(month, monthPart) &&
        matchesCronPart(dayOfWeek, weekdayPart)) {
      void task.destroy()
      return testTime
    }

    // Increment time intelligently based on cron pattern
    testTime = incrementTimeForCronPattern(testTime, cronParts)
    iterations++
  }

  void task.destroy()
  throw new Error(`Could not calculate next execution time for cron expression: ${cronExpression} within reasonable timeframe`)
}

/**
 * Intelligently increment time based on cron pattern to avoid unnecessary iterations
 */
function incrementTimeForCronPattern(currentTime: Date, cronParts: string[]): Date {
  const [minutePart, hourPart, _dayPart, _monthPart, _weekdayPart] = cronParts
  const nextTime = new Date(currentTime)

  // If minute is specific (not wildcard), we can jump to next hour
  if (minutePart !== '*' && !minutePart.includes('/')) {
    const targetMinute = getNextValidCronValue(currentTime.getMinutes(), minutePart)
    if (targetMinute <= currentTime.getMinutes()) {
      // Move to next hour
      nextTime.setHours(nextTime.getHours() + 1, targetMinute, 0, 0)
    } else {
      nextTime.setMinutes(targetMinute, 0, 0)
    }
    return nextTime
  }

  // If hour is specific and we're past it, jump to next day
  if (hourPart !== '*' && !hourPart.includes('/')) {
    const targetHour = getNextValidCronValue(currentTime.getHours(), hourPart)
    if (targetHour <= currentTime.getHours()) {
      // Move to next day
      nextTime.setDate(nextTime.getDate() + 1)
      nextTime.setHours(targetHour, 0, 0, 0)
    } else {
      nextTime.setHours(targetHour, 0, 0, 0)
    }
    return nextTime
  }

  // Default: increment by 1 minute
  nextTime.setTime(nextTime.getTime() + 60 * 1000)
  return nextTime
}

/**
 * Get the next valid value for a cron part
 */
function getNextValidCronValue(currentValue: number, cronPart: string): number {
  if (cronPart === '*') {return currentValue + 1}

  // Handle specific values and ranges
  const values = parseCronPart(cronPart)
  return values.find(v => v > currentValue) || values[0]
}

/**
 * Parse a cron part into an array of valid values
 */
function parseCronPart(cronPart: string): number[] {
  if (cronPart === '*') {return []}

  const values: number[] = []

  // Handle comma-separated values
  if (cronPart.includes(',')) {
    cronPart.split(',').forEach(part => {
      values.push(...parseCronPart(part.trim()))
    })
    return values.sort((a, b) => a - b)
  }

  // Handle ranges
  if (cronPart.includes('-')) {
    const [start, end] = cronPart.split('-').map(n => parseInt(n, 10))
    for (let i = start; i <= end; i++) {
      values.push(i)
    }
    return values
  }

  // Handle step values
  if (cronPart.includes('/')) {
    const [range, step] = cronPart.split('/')
    const stepNum = parseInt(step, 10)

    if (range === '*') {
      // For wildcards with steps, return empty - handled elsewhere
      return []
    }

    const baseValues = parseCronPart(range)
    return baseValues.filter((_, index) => index % stepNum === 0)
  }

  // Single value
  values.push(parseInt(cronPart, 10))
  return values
}

/**
 * Check if a value matches a cron expression part
 */
function matchesCronPart(value: number, cronPart: string): boolean {
  if (cronPart === '*') {return true}

  // Handle step values (e.g., */5)
  if (cronPart.includes('/')) {
    const [range, step] = cronPart.split('/')
    const stepNum = parseInt(step, 10)

    if (range === '*') {
      return value % stepNum === 0
    }
  }

  // Handle ranges (e.g., 1-5)
  if (cronPart.includes('-')) {
    const [start, end] = cronPart.split('-').map(n => parseInt(n, 10))
    return value >= start && value <= end
  }

  // Handle comma-separated values (e.g., 1,3,5)
  if (cronPart.includes(',')) {
    const values = cronPart.split(',').map(n => parseInt(n, 10))
    return values.includes(value)
  }

  // Handle single value
  const cronValue = parseInt(cronPart, 10)
  return value === cronValue
}

/**
 * Handle re-queueing of cron jobs after they execute
 * This ensures the job runs again at the next scheduled time
 */
export async function requeueCronJob(
  workflowId: string,
  cronExpression: string,
  timezone: string | undefined,
  payload: Payload,
  logger: Payload['logger']
): Promise<void> {
  try {
    // Queue the job to run at the next scheduled time
    await payload.jobs.queue({
      input: { cronExpression, timezone, workflowId },
      task: 'workflow-cron-executor',
      waitUntil: getNextCronTime(cronExpression, timezone)
    })

    logger.debug({
      nextRun: getNextCronTime(cronExpression, timezone),
      timezone: timezone || 'UTC',
      workflowId
    }, 'Re-queued cron job')
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      workflowId
    }, 'Failed to re-queue cron job')
  }
}

/**
 * Register or update cron jobs for a specific workflow
 */
export async function updateWorkflowCronJobs(
  workflowId: string,
  payload: Payload,
  logger: Payload['logger']
): Promise<void> {
  try {
    // First, cancel any existing cron jobs for this workflow
    cancelWorkflowCronJobs(workflowId, payload, logger)

    // Get the workflow
    const workflow = await payload.findByID({
      id: workflowId,
      collection: 'workflows',
      depth: 0
    })

    if (!workflow) {
      logger.warn({ workflowId }, 'Workflow not found for cron job update')
      return
    }

    const triggers = workflow.triggers as Array<{
      parameters?: {
        cronExpression?: string
        timezone?: string
        [key: string]: any
      }
      type: string
    }>

    // Find all cron triggers for this workflow
    const cronTriggers = triggers?.filter(t => t.type === 'cron-trigger') || []

    if (cronTriggers.length === 0) {
      logger.debug({ workflowId }, 'No cron triggers found for workflow')
      return
    }

    let scheduledJobs = 0

    for (const trigger of cronTriggers) {
      if (trigger.parameters?.cronExpression) {
        try {
          // Validate cron expression before queueing
          if (!validateCronExpression(trigger.parameters.cronExpression)) {
            logger.error({
              cronExpression: trigger.parameters.cronExpression,
              workflowId,
              workflowName: workflow.name
            }, 'Invalid cron expression format')
            continue
          }

          // Validate timezone if provided
          if (trigger.parameters?.timezone) {
            try {
              new Intl.DateTimeFormat('en', { timeZone: trigger.parameters.timezone })
            } catch {
              logger.error({
                timezone: trigger.parameters.timezone,
                workflowId,
                workflowName: workflow.name
              }, 'Invalid timezone specified')
              continue
            }
          }

          // Calculate next execution time
          const nextExecution = getNextCronTime(trigger.parameters.cronExpression, trigger.parameters?.timezone)

          // Queue the job
          await payload.jobs.queue({
            input: { cronExpression: trigger.parameters.cronExpression, timezone: trigger.parameters?.timezone, workflowId },
            task: 'workflow-cron-executor',
            waitUntil: nextExecution
          })

          scheduledJobs++

          logger.info({
            cronExpression: trigger.parameters.cronExpression,
            nextExecution: nextExecution.toISOString(),
            timezone: trigger.parameters?.timezone || 'UTC',
            workflowId,
            workflowName: workflow.name
          }, 'Scheduled cron job for workflow')
        } catch (error) {
          logger.error({
            cronExpression: trigger.parameters?.cronExpression,
            error: error instanceof Error ? error.message : 'Unknown error',
            timezone: trigger.parameters?.timezone,
            workflowId,
            workflowName: workflow.name
          }, 'Failed to schedule cron job')
        }
      }
    }

    if (scheduledJobs > 0) {
      logger.info({ scheduledJobs, workflowId }, 'Updated cron jobs for workflow')
    }
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      workflowId
    }, 'Failed to update workflow cron jobs')
  }
}

/**
 * Cancel all cron jobs for a specific workflow
 */
export function cancelWorkflowCronJobs(
  workflowId: string,
  payload: Payload,
  logger: Payload['logger']
): void {
  try {
    // Note: PayloadCMS job system doesn't have a built-in way to cancel specific jobs by input
    // This is a limitation we need to work around
    // For now, we log that we would cancel jobs for this workflow
    logger.debug({ workflowId }, 'Would cancel existing cron jobs for workflow (PayloadCMS limitation: cannot selectively cancel jobs)')
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      workflowId
    }, 'Failed to cancel workflow cron jobs')
  }
}

/**
 * Remove cron jobs for a deleted workflow
 */
export function removeWorkflowCronJobs(
  workflowId: string,
  payload: Payload,
  logger: Payload['logger']
): void {
  try {
    cancelWorkflowCronJobs(workflowId, payload, logger)
    logger.info({ workflowId }, 'Removed cron jobs for deleted workflow')
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      workflowId
    }, 'Failed to remove workflow cron jobs')
  }
}
