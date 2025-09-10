import type {Field} from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

import {triggerField} from "./helpers.js"

export function getCollectionTriggerFields<T extends string>(
  collectionTriggers: WorkflowsPluginConfig<T>['collectionTriggers']
): Field[] {
  return [
    triggerField({
      name: 'collectionSlug',
      type: 'select',
      options: Object.keys(collectionTriggers || {}),
    }),
    triggerField({
      name: 'operation',
      type: 'select',
      options: [
        'create',
        'delete',
        'read',
        'update',
      ],
    })
  ]
}
