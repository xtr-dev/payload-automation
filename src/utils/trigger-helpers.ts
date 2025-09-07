import type { Field } from 'payload'
import type { CustomTriggerConfig } from '../plugin/config-types.js'

/**
 * Helper function to create a virtual trigger parameter field
 * Handles the boilerplate for storing/reading from the parameters JSON field
 */
export function createTriggerParameter(
  name: string,
  fieldConfig: any, // Use any to allow flexible field configurations
  triggerSlug: string
): Field {
  // Create a unique field name by prefixing with trigger slug
  const uniqueFieldName = `__trigger_${triggerSlug}_${name}`
  
  return {
    ...fieldConfig,
    name: uniqueFieldName,
    virtual: true,
    admin: {
      ...fieldConfig.admin,
      condition: (_, siblingData) => siblingData?.type === triggerSlug && (
        fieldConfig.admin?.condition ? 
          fieldConfig.admin.condition(_, siblingData) : 
          true
      )
    },
    hooks: {
      ...fieldConfig.hooks,
      afterRead: [
        ...(fieldConfig.hooks?.afterRead || []),
        ({ siblingData }) => siblingData?.parameters?.[name] || fieldConfig.defaultValue
      ],
      beforeChange: [
        ...(fieldConfig.hooks?.beforeChange || []),
        ({ value, siblingData }) => {
          if (!siblingData.parameters) siblingData.parameters = {}
          siblingData.parameters[name] = value
          return undefined // Virtual field, don't store directly
        }
      ]
    },
    validate: fieldConfig.validate || fieldConfig.required ? 
      (value: any, args: any) => {
        const paramValue = value ?? args.siblingData?.parameters?.[name]
        
        // Check required
        if (fieldConfig.required && args.siblingData?.type === triggerSlug && !paramValue) {
          return `${fieldConfig.admin?.description || name} is required for ${triggerSlug}`
        }
        
        // Run original validation if present
        return fieldConfig.validate?.(paramValue, args) ?? true
      } : 
      undefined
  } as Field
}

/**
 * Helper to create multiple trigger parameter fields at once
 */
export function createTriggerParameters(
  triggerSlug: string,
  parameters: Record<string, any>
): Field[] {
  return Object.entries(parameters).map(([name, fieldConfig]) => 
    createTriggerParameter(name, fieldConfig, triggerSlug)
  )
}

/**
 * Main trigger builder function that creates a fluent API for defining triggers
 */
export function createTrigger<TSlug extends string>(slug: TSlug) {
  return {
    /**
     * Define parameters for this trigger using a clean object syntax
     * @param paramConfig - Object where keys are parameter names and values are Field configs
     * @returns Complete CustomTriggerConfig ready for use
     */
    parameters(paramConfig: Record<string, any>): CustomTriggerConfig {
      return {
        slug,
        inputs: Object.entries(paramConfig).map(([name, fieldConfig]) => 
          createTriggerParameter(name, fieldConfig, slug)
        )
      }
    }
  }
}

/**
 * Advanced trigger builder with chainable methods for more complex scenarios
 */
export function createAdvancedTrigger<TSlug extends string>(slug: TSlug) {
  const builder = {
    slug,
    _parameters: {} as Record<string, any>,
    
    /**
     * Set all parameters at once
     */
    parameters(paramConfig: Record<string, any>) {
      this._parameters = paramConfig
      return this
    },
    
    /**
     * Add a single parameter
     */
    parameter(name: string, fieldConfig: any) {
      this._parameters[name] = fieldConfig
      return this
    },
    
    /**
     * Extend with existing parameter sets (useful for common patterns)
     */
    extend(baseParameters: Record<string, any>) {
      this._parameters = { ...baseParameters, ...this._parameters }
      return this
    },
    
    /**
     * Build the final trigger configuration
     */
    build(): CustomTriggerConfig {
      return {
        slug: this.slug,
        inputs: Object.entries(this._parameters).map(([name, fieldConfig]) => 
          createTriggerParameter(name, fieldConfig, this.slug)
        )
      }
    }
  }
  
  return builder
}