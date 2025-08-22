import type { TaskHandler } from "payload"

export const sendEmailHandler: TaskHandler<'send-email'> = async ({ input, req }) => {
  if (!input) {
    throw new Error('No input provided')
  }

  const { bcc, cc, from, html, subject, text, to } = input

  if (!to || typeof to !== 'string') {
    throw new Error('Recipient email address (to) is required')
  }

  if (!subject || typeof subject !== 'string') {
    throw new Error('Subject is required')
  }

  if (!text && !html) {
    throw new Error('Either text or html content is required')
  }

  try {
    // Use Payload's email functionality
    const emailData = {
      bcc: Array.isArray(bcc) ? bcc.filter(email => typeof email === 'string') : undefined,
      cc: Array.isArray(cc) ? cc.filter(email => typeof email === 'string') : undefined,
      from: typeof from === 'string' ? from : undefined,
      html: typeof html === 'string' ? html : undefined,
      subject,
      text: typeof text === 'string' ? text : undefined,
      to
    }

    // Clean up undefined values
    Object.keys(emailData).forEach(key => {
      if (emailData[key as keyof typeof emailData] === undefined) {
        delete emailData[key as keyof typeof emailData]
      }
    })

    const result = await req.payload.sendEmail(emailData)

    return {
      output: {
        messageId: (result && typeof result === 'object' && 'messageId' in result) ? result.messageId : 'unknown',
        response: typeof result === 'object' ? JSON.stringify(result) : String(result)
      },
      state: 'succeeded'
    }
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : 'Failed to send email',
      state: 'failed'
    }
  }
}