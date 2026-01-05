import type { Field, JsonObject, PayloadRequest, TaskConfig, TaskHandler } from 'payload'

/**
 * Configuration for creating a step with the factory.
 */
export interface StepDefinition<TSlug extends string> {
  /** Unique identifier for the step */
  slug: TSlug
  /** Human-readable label for the step (optional, defaults to slug) */
  label?: string
  /** Input fields schema */
  inputSchema: Field[]
  /** Output fields schema */
  outputSchema: Field[]
  /**
   * Optional validation function. Throw an error if validation fails.
   * Runs before the execute function.
   */
  validate?: (input: JsonObject) => void
  /**
   * The main execution function for the step.
   * Should return the output data on success, or throw an error on failure.
   */
  execute: (input: JsonObject, req: PayloadRequest) => Promise<JsonObject>
}

/**
 * The result type returned by createStep.
 * Combines TaskConfig with the handler for convenience.
 */
export type StepTask<TSlug extends string> = TaskConfig<TSlug>

/**
 * Creates a step definition that combines TaskConfig and handler in one place.
 *
 * This factory eliminates the need for separate `{step}.ts` and `{step}-handler.ts` files
 * by providing a single unified definition.
 *
 * @example
 * ```typescript
 * export const myStep = createStep({
 *   slug: 'my-step',
 *   inputSchema: [
 *     { name: 'url', type: 'text', required: true }
 *   ],
 *   outputSchema: [
 *     { name: 'result', type: 'json' }
 *   ],
 *   validate: (input) => {
 *     if (!input.url) throw new Error('URL is required')
 *   },
 *   execute: async (input, req) => {
 *     const response = await fetch(input.url)
 *     return { result: await response.json() }
 *   }
 * })
 * ```
 */
export function createStep<TSlug extends string>(
  definition: StepDefinition<TSlug>
): StepTask<TSlug> {
  const { slug, label, inputSchema, outputSchema, validate, execute } = definition

  // Create the handler that wraps validation and execution
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = async ({ input, req }: any) => {
    try {
      const jsonInput = (input ?? {}) as JsonObject

      // Run validation if provided
      if (validate) {
        validate(jsonInput)
      }

      // Execute the step
      const output = await execute(jsonInput, req)
      return {
        output,
        state: 'succeeded'
      }
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        state: 'failed'
      }
    }
  }

  return {
    slug,
    label,
    handler,
    inputSchema,
    outputSchema
  } as StepTask<TSlug>
}

/**
 * Helper type to extract input type from a step's inputSchema.
 * Note: This provides a basic type based on field names, not full type inference.
 */
export type StepInput<T extends StepTask<string>> = T extends StepTask<infer _>
  ? Record<string, unknown>
  : never

/**
 * Helper type to extract output type from a step's outputSchema.
 * Note: This provides a basic type based on field names, not full type inference.
 */
export type StepOutput<T extends StepTask<string>> = T extends StepTask<infer _>
  ? Record<string, unknown>
  : never
