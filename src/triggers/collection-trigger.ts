import type {TriggerConfig} from '../plugin/config-types.js'

export const collectionTrigger: TriggerConfig = ({collectionTriggers}) => ({
  slug: 'collection-hook',
  parameters: [
    {
      name: 'collectionSlug',
      type: 'select',
      options: Object.keys(collectionTriggers || {}),
    },
    {
      name: 'hook',
      type: 'select',
      options: [
        "afterChange",
        "afterDelete",
        "afterError",
        "afterForgotPassword",
        "afterLogin",
        "afterLogout",
        "afterMe",
        "afterOperation",
        "afterRead",
        "afterRefresh",
        "beforeChange",
        "beforeDelete",
        "beforeLogin",
        "beforeOperation",
        "beforeRead",
        "beforeValidate",
        "me",
        "refresh"
      ]
    }
  ]
})
