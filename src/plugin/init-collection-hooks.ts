import type {Payload} from "payload"
import type {Logger} from "pino"

import type { WorkflowExecutor } from "../core/workflow-executor.js"
import type {CollectionTriggerConfigCrud, WorkflowsPluginConfig} from "./config-types.js"

export function initCollectionHooks<T extends string>(pluginOptions: WorkflowsPluginConfig<T>, payload: Payload, logger: Payload['logger'], executor: WorkflowExecutor) {
  
  if (!pluginOptions.collectionTriggers || Object.keys(pluginOptions.collectionTriggers).length === 0) {
    logger.warn('No collection triggers configured in plugin options')
    return
  }

  logger.info({
    configuredCollections: Object.keys(pluginOptions.collectionTriggers),
    availableCollections: Object.keys(payload.collections)
  }, 'Starting collection hook registration')

  // Add hooks to configured collections
  for (const [collectionSlug, triggerConfig] of Object.entries(pluginOptions.collectionTriggers)) {
    if (!triggerConfig) {
      logger.debug({collectionSlug}, 'Skipping collection with falsy trigger config')
      continue
    }

    const collection = payload.collections[collectionSlug as T]
    const crud: CollectionTriggerConfigCrud = triggerConfig === true ? {
      create: true,
      delete: true,
      read: true,
      update: true,
    } : triggerConfig

    if (!collection.config.hooks) {
      collection.config.hooks = {} as typeof collection.config.hooks
    }

    if (crud.update || crud.create) {
      collection.config.hooks.afterChange = collection.config.hooks.afterChange || []
      collection.config.hooks.afterChange.push(async (change) => {
        const operation = change.operation as 'create' | 'update'
        logger.debug({
          slug: change.collection.slug,
          operation,
        }, 'Collection hook triggered')

        // Execute workflows for this trigger
        await executor.executeTriggeredWorkflows(
          change.collection.slug,
          operation,
          change.doc,
          change.previousDoc,
          change.req
        )
      })
    }

    if (crud.read) {
      collection.config.hooks.afterRead = collection.config.hooks.afterRead || []
      collection.config.hooks.afterRead.push(async (change) => {
        logger.debug({
          slug: change.collection.slug,
          operation: 'read',
        }, 'Collection hook triggered')

        // Execute workflows for this trigger
        await executor.executeTriggeredWorkflows(
          change.collection.slug,
          'read',
          change.doc,
          undefined,
          change.req
        )
      })
    }

    if (crud.delete) {
      collection.config.hooks.afterDelete = collection.config.hooks.afterDelete || []
      collection.config.hooks.afterDelete.push(async (change) => {
        logger.debug({
          slug: change.collection.slug,
          operation: 'delete',
        }, 'Collection hook triggered')

        // Execute workflows for this trigger
        await executor.executeTriggeredWorkflows(
          change.collection.slug,
          'delete',
          change.doc,
          undefined,
          change.req
        )
      })
    }

    if (collection) {
      logger.info({
        collectionSlug,
        hooksRegistered: {
          afterChange: crud.update || crud.create,
          afterRead: crud.read,
          afterDelete: crud.delete
        }
      }, 'Collection hooks registered successfully')
    } else {
      logger.error({
        collectionSlug,
        availableCollections: Object.keys(payload.collections)
      }, 'Collection not found for trigger configuration - check collection slug spelling')
    }
  }
}
