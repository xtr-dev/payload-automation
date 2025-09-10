import type {Field} from 'payload'

import {triggerField} from "./helpers.js"

export function getGlobalTriggerFields(): Field[] {
  return [
    triggerField({
      name: 'global',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'global-trigger',
        description: 'Global that triggers the workflow',
      },
      options: [], // Will be populated dynamically based on available globals
    }),
    triggerField({
      name: 'globalOperation',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'global-trigger',
        description: 'Global operation that triggers the workflow',
      },
      options: [
        'update'
      ],
    })
  ]
}