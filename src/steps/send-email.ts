import type { TaskConfig } from "payload"

import { sendEmailHandler } from "./send-email-handler.js"

export const SendEmailStepTask = {
  slug: 'send-email',
  handler: sendEmailHandler,
  inputSchema: [
    {
      name: 'to',
      type: 'text',
      admin: {
        description: 'Recipient email address'
      },
      required: true
    },
    {
      name: 'from',
      type: 'text',
      admin: {
        description: 'Sender email address (optional, uses default if not provided)'
      }
    },
    {
      name: 'subject',
      type: 'text',
      admin: {
        description: 'Email subject line'
      },
      required: true
    },
    {
      name: 'text',
      type: 'textarea',
      admin: {
        description: 'Plain text email content'
      }
    },
    {
      name: 'html',
      type: 'textarea',
      admin: {
        description: 'HTML email content (optional)'
      }
    },
    {
      name: 'cc',
      type: 'text',
      admin: {
        description: 'CC recipients'
      },
      hasMany: true
    },
    {
      name: 'bcc',
      type: 'text',
      admin: {
        description: 'BCC recipients'
      },
      hasMany: true
    }
  ],
  outputSchema: [
    {
      name: 'messageId',
      type: 'text',
      admin: {
        description: 'Email message ID from the mail server'
      }
    },
    {
      name: 'response',
      type: 'text',
      admin: {
        description: 'Response from the mail server'
      }
    }
  ]
} satisfies TaskConfig<'send-email'>