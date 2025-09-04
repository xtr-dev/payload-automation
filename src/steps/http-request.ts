import type {TaskConfig} from "payload"

import {httpStepHandler} from "./http-request-handler.js"

export const HttpRequestStepTask = {
  slug: 'http-request-step',
  handler: httpStepHandler,
  inputSchema: [
    {
      name: 'url',
      type: 'text',
      admin: {
        description: 'The URL to make the HTTP request to'
      },
      required: true
    },
    {
      name: 'method',
      type: 'select',
      options: [
        { label: 'GET', value: 'GET' },
        { label: 'POST', value: 'POST' },
        { label: 'PUT', value: 'PUT' },
        { label: 'DELETE', value: 'DELETE' },
        { label: 'PATCH', value: 'PATCH' }
      ],
      defaultValue: 'GET',
      admin: {
        description: 'HTTP method to use'
      }
    },
    {
      name: 'headers',
      type: 'json',
      admin: {
        description: 'HTTP headers as JSON object (e.g., {"Content-Type": "application/json"})'
      }
    },
    {
      name: 'body',
      type: 'json',
      admin: {
        condition: (_, siblingData) => siblingData?.method !== 'GET' && siblingData?.method !== 'DELETE',
        description: 'Request body data. Use JSONPath to reference values (e.g., {"postId": "$.trigger.doc.id", "title": "$.trigger.doc.title"})'
      }
    },
    {
      name: 'timeout',
      type: 'number',
      defaultValue: 30000,
      admin: {
        description: 'Request timeout in milliseconds (default: 30000)'
      }
    },
    {
      name: 'authentication',
      type: 'group',
      fields: [
        {
          name: 'type',
          type: 'select',
          options: [
            { label: 'None', value: 'none' },
            { label: 'Bearer Token', value: 'bearer' },
            { label: 'Basic Auth', value: 'basic' },
            { label: 'API Key Header', value: 'apikey' }
          ],
          defaultValue: 'none',
          admin: {
            description: 'Authentication method'
          }
        },
        {
          name: 'token',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'bearer',
            description: 'Bearer token value'
          }
        },
        {
          name: 'username',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'basic',
            description: 'Basic auth username'
          }
        },
        {
          name: 'password',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'basic',
            description: 'Basic auth password'
          }
        },
        {
          name: 'headerName',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'apikey',
            description: 'API key header name (e.g., "X-API-Key")'
          }
        },
        {
          name: 'headerValue',
          type: 'text',
          admin: {
            condition: (_, siblingData) => siblingData?.type === 'apikey',
            description: 'API key value'
          }
        }
      ]
    },
    {
      name: 'retries',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 5,
      admin: {
        description: 'Number of retry attempts on failure (max: 5)'
      }
    },
    {
      name: 'retryDelay',
      type: 'number',
      defaultValue: 1000,
      admin: {
        condition: (_, siblingData) => (siblingData?.retries || 0) > 0,
        description: 'Delay between retries in milliseconds'
      }
    }
  ],
  outputSchema: [
    {
      name: 'status',
      type: 'number',
      admin: {
        description: 'HTTP status code'
      }
    },
    {
      name: 'statusText',
      type: 'text',
      admin: {
        description: 'HTTP status text'
      }
    },
    {
      name: 'headers',
      type: 'json',
      admin: {
        description: 'Response headers'
      }
    },
    {
      name: 'body',
      type: 'textarea',
      admin: {
        description: 'Response body'
      }
    },
    {
      name: 'data',
      type: 'json',
      admin: {
        description: 'Parsed response data (if JSON)'
      }
    },
    {
      name: 'duration',
      type: 'number',
      admin: {
        description: 'Request duration in milliseconds'
      }
    }
  ]
} satisfies TaskConfig<'http-request-step'>
