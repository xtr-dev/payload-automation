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
        description: 'Recipient email address. Use JSONPath for dynamic values (e.g., "$.trigger.doc.email" or "$.trigger.user.email")'
      },
      required: true
    },
    {
      name: 'from',
      type: 'text',
      admin: {
        description: 'Sender email address. Use JSONPath if needed (e.g., "$.trigger.doc.senderEmail"). Uses default if not provided.'
      }
    },
    {
      name: 'subject',
      type: 'text',
      admin: {
        description: 'Email subject line. Can include JSONPath references (e.g., "Order #$.trigger.doc.orderNumber received")'
      },
      required: true
    },
    {
      name: 'text',
      type: 'textarea',
      admin: {
        description: 'Plain text email content. Use JSONPath to include dynamic content (e.g., "Dear $.trigger.doc.customerName, your order #$.trigger.doc.id has been received.")'
      }
    },
    {
      name: 'html',
      type: 'textarea',
      admin: {
        description: 'HTML email content. Use JSONPath for dynamic values (e.g., "<h1>Order #$.trigger.doc.orderNumber</h1>")'
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