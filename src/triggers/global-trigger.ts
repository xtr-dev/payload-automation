import type { Field } from 'payload'

export function getGlobalTriggerFields(): Field[] {
  return [
    {
      name: '__builtin_global',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'global-trigger',
        description: 'Global that triggers the workflow',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            return siblingData?.parameters?.global || undefined
          }
        ],
        beforeChange: [
          ({ siblingData, value }) => {
            if (!siblingData.parameters) {siblingData.parameters = {}}
            siblingData.parameters.global = value
            return undefined // Virtual field, don't store directly
          }
        ]
      },
      options: [], // Will be populated dynamically based on available globals
      virtual: true,
    },
    {
      name: '__builtin_globalOperation',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'global-trigger',
        description: 'Global operation that triggers the workflow',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            return siblingData?.parameters?.globalOperation || undefined
          }
        ],
        beforeChange: [
          ({ siblingData, value }) => {
            if (!siblingData.parameters) {siblingData.parameters = {}}
            siblingData.parameters.globalOperation = value
            return undefined // Virtual field, don't store directly
          }
        ]
      },
      options: [
        'update'
      ],
      virtual: true,
    }
  ]
}