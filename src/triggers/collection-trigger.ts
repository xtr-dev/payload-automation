import type {TriggerConfig} from '../plugin/config-types.js'

export const collectionTrigger: TriggerConfig = ({collectionTriggers}) => ({
  slug: 'collection',
  fields: [
    {
      name: 'collectionSlug',
      type: 'select',
      options: Object.keys(collectionTriggers || {}),
    },
    {
      name: 'operation',
      type: 'select',
      options: [
        'create',
        'delete',
        'read',
        'update',
      ],
    }
  ]
})
