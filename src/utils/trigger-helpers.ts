import type { Field } from 'payload'
import type { CustomTriggerConfig } from '../plugin/config-types.js'

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
export function createTriggerField(field: any, triggerSlug: string): Field {
  const originalName = field.name
  if (!originalName) {
    throw new Error('Field must have a name property')
  }

  // Create a unique field name by prefixing with trigger slug
  const uniqueFieldName = `__trigger_${triggerSlug}_${originalName}`
  
  const resultField: any = {
    ...field,
    name: uniqueFieldName,
    virtual: true,
    admin: {
      ...(field.admin || {}),
      condition: (data: any, siblingData: any) => {
        // Only show this field when the trigger type matches
        const triggerMatches = siblingData?.type === triggerSlug
        
        // If the original field had a condition, combine it with our trigger condition
        if (field.admin?.condition) {
          return triggerMatches && field.admin.condition(data, siblingData)
        }
        
        return triggerMatches
      }
    },
    hooks: {
      ...(field.hooks || {}),
      afterRead: [
        ...(field.hooks?.afterRead || []),
        ({ siblingData }: any) => {
          // Read the value from the parameters JSON field
          return siblingData?.parameters?.[originalName] ?? field.defaultValue
        }
      ],
      beforeChange: [
        ...(field.hooks?.beforeChange || []),
        ({ value, siblingData }: any) => {
          // Store the value in the parameters JSON field
          if (!siblingData.parameters) {
            siblingData.parameters = {}
          }
          siblingData.parameters[originalName] = value
          return undefined // Virtual field, don't store directly
        }
      ]
    }
  }

  // Only add validate if the field supports it (data fields)
  if (field.validate || field.required) {
    resultField.validate = (value: any, args: any) => {
      const paramValue = value ?? args.siblingData?.parameters?.[originalName]
      
      // Check required validation
      if (field.required && args.siblingData?.type === triggerSlug && !paramValue) {
        const label = field.label || field.admin?.description || originalName
        return `${label} is required for ${triggerSlug}`
      }
      
      // Run original validation if present
      if (field.validate) {
        return field.validate(paramValue, args)
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
export function createTrigger(slug: string, fields: Field[]): CustomTriggerConfig {
  return {
    slug,
    inputs: fields.map(field => createTriggerField(field, slug))
  }
}