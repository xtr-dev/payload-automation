import type {TriggerConfig} from '../plugin/config-types.js'

export const globalTrigger: TriggerConfig = ({globalTriggers}) => ({
  slug: 'global-hook',
  parameters: [
    {
      name: 'global',
      type: 'select',
      admin: {
        description: 'Global that triggers the workflow',
      },
      options: Object.keys(globalTriggers || {}),
    },
    {
      name: 'operation',
      type: 'select',
      admin: {
        description: 'Global hook that triggers the workflow',
      },
      options: [
        "afterChange",
        "afterRead", 
        "beforeChange",
        "beforeRead",
        "beforeValidate"
      ],
    }
  ]
})
