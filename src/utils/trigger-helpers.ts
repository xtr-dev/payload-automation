import type { Field } from 'payload'

import type { CustomTriggerConfig } from '../plugin/config-types.js'

// Types for better type safety
interface FieldWithName {
  name: string
  [key: string]: unknown
}

interface HookContext {
  siblingData: Record<string, unknown>
  value?: unknown
}

interface ValidationContext {
  siblingData: Record<string, unknown>
}

/**
 * Creates a virtual field for a trigger parameter that stores its value in the parameters JSON field
 * 
 * @param field - Standard PayloadCMS field configuration (must be a data field with a name)
 * @param triggerSlug - The slug of the trigger this field belongs to
 * @returns Modified field with virtual storage hooks and proper naming
 * 
 * @example
 * ```typescript
 * const myTrigger: CustomTriggerConfig = {
 *   slug: 'my-trigger',
 *   inputs: [
 *     createTriggerField({
 *       name: 'webhookUrl',
 *       type: 'text',
 *       required: true,
 *       admin: {
 *         description: 'URL to call when triggered'
 *       }
 *     }, 'my-trigger')
 *   ]
 * }
 * ```
 */
export function createTriggerField(field: FieldWithName, triggerSlug: string): Field {
  const originalName = field.name
  if (!originalName) {
    throw new Error('Field must have a name property')
  }

  // Create a unique field name by prefixing with trigger slug
  const uniqueFieldName = `__trigger_${triggerSlug}_${originalName}`
  
  const resultField: Record<string, unknown> = {
    ...field,
    admin: {
      ...(field.admin as Record<string, unknown> || {}),
      condition: (data: unknown, siblingData: Record<string, unknown>) => {
        // Only show this field when the trigger type matches
        const triggerMatches = siblingData?.type === triggerSlug
        
        // If the original field had a condition, combine it with our trigger condition
        const originalCondition = (field.admin as Record<string, unknown>)?.condition
        if (originalCondition && typeof originalCondition === 'function') {
          return triggerMatches && (originalCondition as (data: unknown, siblingData: Record<string, unknown>) => boolean)(data, siblingData)
        }
        
        return triggerMatches
      }
    },
    hooks: {
      ...(field.hooks as Record<string, unknown[]> || {}),
      afterRead: [
        ...((field.hooks as Record<string, unknown[]>)?.afterRead || []),
        ({ siblingData }: HookContext) => {
          // Read the value from the parameters JSON field
          const parameters = siblingData?.parameters as Record<string, unknown>
          return parameters?.[originalName] ?? (field as Record<string, unknown>).defaultValue
        }
      ],
      beforeChange: [
        ...((field.hooks as Record<string, unknown[]>)?.beforeChange || []),
        ({ siblingData, value }: HookContext) => {
          // Store the value in the parameters JSON field
          if (!siblingData.parameters) {
            siblingData.parameters = {}
          }
          const parameters = siblingData.parameters as Record<string, unknown>
          parameters[originalName] = value
          return undefined // Virtual field, don't store directly
        }
      ]
    },
    name: uniqueFieldName,
    virtual: true,
  }

  // Only add validate if the field supports it (data fields)
  const hasValidation = (field as Record<string, unknown>).validate || (field as Record<string, unknown>).required
  if (hasValidation) {
    resultField.validate = (value: unknown, args: ValidationContext) => {
      const parameters = args.siblingData?.parameters as Record<string, unknown>
      const paramValue = value ?? parameters?.[originalName]
      
      // Check required validation
      const isRequired = (field as Record<string, unknown>).required
      if (isRequired && args.siblingData?.type === triggerSlug && !paramValue) {
        const fieldLabel = (field as Record<string, unknown>).label as string
        const adminDesc = ((field as Record<string, unknown>).admin as Record<string, unknown>)?.description as string
        const label = fieldLabel || adminDesc || originalName
        return `${label} is required for ${triggerSlug}`
      }
      
      // Run original validation if present
      const originalValidate = (field as Record<string, unknown>).validate
      if (originalValidate && typeof originalValidate === 'function') {
        return (originalValidate as (value: unknown, args: ValidationContext) => boolean | string)(paramValue, args)
      }
      
      return true
    }
  }

  return resultField as Field
}

/**
 * Creates a custom trigger configuration with the provided fields
 * 
 * @param slug - Unique identifier for the trigger
 * @param fields - Array of PayloadCMS fields that will be shown as trigger parameters
 * @returns Complete trigger configuration
 * 
 * @example
 * ```typescript
 * const webhookTrigger = createTrigger('webhook', [
 *   {
 *     name: 'url',
 *     type: 'text',
 *     required: true,
 *     admin: {
 *       description: 'Webhook URL'
 *     }
 *   },
 *   {
 *     name: 'method',
 *     type: 'select',
 *     options: ['GET', 'POST', 'PUT', 'DELETE'],
 *     defaultValue: 'POST'
 *   }
 * ])
 * ```
 */
export function createTrigger(slug: string, fields: FieldWithName[]): CustomTriggerConfig {
  return {
    slug,
    inputs: fields.map(field => createTriggerField(field, slug))
  }
}