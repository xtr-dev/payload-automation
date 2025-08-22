import type {TaskConfig} from "payload"

import {httpStepHandler} from "./http-request-handler.js"

export const HttpRequestStepTask = {
  slug: 'http-request-step',
  handler: httpStepHandler,
  inputSchema: [
    {
      name: 'url',
      type: 'text',
    }
  ],
  outputSchema: [
    {
      name: 'response',
      type: 'textarea',
    }
  ]
} satisfies TaskConfig<'http-request-step'>
