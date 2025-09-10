import type { Field } from 'payload'
import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

export function getCollectionTriggerFields<T extends string>(
  collectionTriggers: WorkflowsPluginConfig<T>['collectionTriggers']
): Field[] {
  return [
    {
      name: '__builtin_collectionSlug',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'collection-trigger',
        description: 'Collection that triggers the workflow',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            return siblingData?.parameters?.collectionSlug || undefined
          }
        ],
        beforeChange: [
          ({ siblingData, value }) => {
            if (!siblingData.parameters) {siblingData.parameters = {}}
            siblingData.parameters.collectionSlug = value
            return undefined // Virtual field, don't store directly
          }
        ]
      },
      options: Object.keys(collectionTriggers || {}),
      virtual: true,
    },
    {
      name: '__builtin_operation',
      type: 'select',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'collection-trigger',
        description: 'Collection operation that triggers the workflow',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            return siblingData?.parameters?.operation || undefined
          }
        ],
        beforeChange: [
          ({ siblingData, value }) => {
            if (!siblingData.parameters) {siblingData.parameters = {}}
            siblingData.parameters.operation = value
            return undefined // Virtual field, don't store directly
          }
        ]
      },
      options: [
        'create',
        'delete',
        'read',
        'update',
      ],
      virtual: true,
    }
  ]
}