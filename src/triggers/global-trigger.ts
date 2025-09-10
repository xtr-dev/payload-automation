import type {TriggerConfig} from '../plugin/config-types.js'

export const globalTrigger: TriggerConfig = () => ({
  slug: 'global',
  fields: [
    {
      name: 'global',
      type: 'select',
      admin: {
        description: 'Global that triggers the workflow',
      },
      options: [], // Will be populated dynamically based on available globals
    },
    {
      name: 'globalOperation',
      type: 'select',
      admin: {
        description: 'Global operation that triggers the workflow',
      },
      options: [
        'update'
      ],
    }
  ]
})