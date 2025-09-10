import type {Field} from 'payload'

import {triggerField} from "./helpers.js"

export function getCronTriggerFields(): Field[] {
  return [
    triggerField({
      name: 'cronExpression',
      type: 'text',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'cron-trigger',
        description: 'Cron expression for scheduled execution (e.g., "0 0 * * *" for daily at midnight)',
        placeholder: '0 0 * * *'
      },
      validate: (value: any, {siblingData}: any) => {
        const cronValue = value || siblingData?.parameters?.cronExpression
        if (siblingData?.type === 'cron-trigger' && !cronValue) {
          return 'Cron expression is required for cron triggers'
        }

        // Validate cron expression format if provided
        if (siblingData?.type === 'cron-trigger' && cronValue) {
          // Basic format validation - should be 5 parts separated by spaces
          const cronParts = cronValue.trim().split(/\s+/)
          if (cronParts.length !== 5) {
            return 'Invalid cron expression format. Expected 5 parts: "minute hour day month weekday" (e.g., "0 9 * * 1")'
          }

          // Additional validation could use node-cron but we avoid dynamic imports here
          // The main validation happens at runtime in the cron scheduler
        }

        return true
      },
    }),
    triggerField({
      name: 'timezone',
      type: 'text',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'cron-trigger',
        description: 'Timezone for cron execution (e.g., "America/New_York", "Europe/London"). Defaults to UTC.',
        placeholder: 'UTC'
      },
      defaultValue: 'UTC',
      validate: (value: any, {siblingData}: any) => {
        const tzValue = value || siblingData?.parameters?.timezone
        if (siblingData?.type === 'cron-trigger' && tzValue) {
          try {
            // Test if timezone is valid by trying to create a date with it
            new Intl.DateTimeFormat('en', {timeZone: tzValue})
            return true
          } catch {
            return `Invalid timezone: ${tzValue}. Please use a valid IANA timezone identifier (e.g., "America/New_York", "Europe/London")`
          }
        }
        return true
      },
    })
  ]
}