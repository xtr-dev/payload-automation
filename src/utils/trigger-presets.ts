import { createAdvancedTrigger } from './trigger-helpers.js'

/**
 * Common parameter sets for reuse across different triggers
 */

export const webhookParameters: Record<string, any> = {
  path: {
    type: 'text',
    required: true,
    admin: {
      description: 'URL path for the webhook endpoint (e.g., "my-webhook")'
    },
    validate: (value: any) => {
      if (typeof value === 'string' && value.includes(' ')) {
        return 'Webhook path cannot contain spaces'
      }
      return true
    }
  },
  secret: {
    type: 'text',
    admin: {
      description: 'Secret key for webhook signature validation (optional but recommended)'
    }
  },
  headers: {
    type: 'json',
    admin: {
      description: 'Expected HTTP headers for validation (JSON object)'
    }
  }
}

export const cronParameters: Record<string, any> = {
  expression: {
    type: 'text',
    required: true,
    admin: {
      description: 'Cron expression for scheduling (e.g., "0 9 * * 1" for every Monday at 9 AM)',
      placeholder: '0 9 * * 1'
    }
  },
  timezone: {
    type: 'text',
    defaultValue: 'UTC',
    admin: {
      description: 'Timezone for cron execution (e.g., "America/New_York", "Europe/London")',
      placeholder: 'UTC'
    },
    validate: (value: any) => {
      if (value) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value as string })
          return true
        } catch {
          return `Invalid timezone: ${value}. Please use a valid IANA timezone identifier`
        }
      }
      return true
    }
  }
}

export const eventParameters: Record<string, any> = {
  eventTypes: {
    type: 'select',
    hasMany: true,
    options: [
      { label: 'User Created', value: 'user.created' },
      { label: 'User Updated', value: 'user.updated' },
      { label: 'Document Published', value: 'document.published' },
      { label: 'Payment Completed', value: 'payment.completed' }
    ],
    admin: {
      description: 'Event types that should trigger this workflow'
    }
  },
  filters: {
    type: 'json',
    admin: {
      description: 'JSON filters to apply to event data (e.g., {"status": "active"})'
    }
  }
}

/**
 * Preset trigger builders for common patterns
 */

/**
 * Create a webhook trigger with common webhook parameters pre-configured
 */
export function webhookTrigger<TSlug extends string>(slug: TSlug) {
  return createAdvancedTrigger(slug).extend(webhookParameters)
}

/**
 * Create a scheduled/cron trigger with timing parameters pre-configured
 */
export function cronTrigger<TSlug extends string>(slug: TSlug) {
  return createAdvancedTrigger(slug).extend(cronParameters)
}

/**
 * Create an event-driven trigger with event filtering parameters
 */
export function eventTrigger<TSlug extends string>(slug: TSlug) {
  return createAdvancedTrigger(slug).extend(eventParameters)
}

/**
 * Create a simple manual trigger (no parameters needed)
 */
export function manualTrigger<TSlug extends string>(slug: TSlug) {
  return {
    slug,
    inputs: []
  }
}

/**
 * Create an API trigger for external systems to call
 */
export function apiTrigger<TSlug extends string>(slug: TSlug) {
  return createAdvancedTrigger(slug).extend({
    endpoint: {
      type: 'text',
      required: true,
      admin: {
        description: 'API endpoint path (e.g., "/api/triggers/my-trigger")'
      }
    },
    method: {
      type: 'select',
      options: ['GET', 'POST', 'PUT', 'PATCH'],
      defaultValue: 'POST',
      admin: {
        description: 'HTTP method for the API endpoint'
      }
    },
    authentication: {
      type: 'select',
      options: [
        { label: 'None', value: 'none' },
        { label: 'API Key', value: 'api-key' },
        { label: 'Bearer Token', value: 'bearer' },
        { label: 'Basic Auth', value: 'basic' }
      ],
      defaultValue: 'api-key',
      admin: {
        description: 'Authentication method for the API endpoint'
      }
    }
  })
}