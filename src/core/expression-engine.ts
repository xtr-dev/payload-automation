import jsonata from 'jsonata'

/**
 * Expression engine using JSONata for safe, sandboxed expression evaluation.
 * Used for both conditions and data transformation in workflows.
 *
 * @example Conditions
 * ```
 * trigger.doc._status = "published"
 * trigger.doc.count > 10 and trigger.doc.enabled
 * $exists(steps.validate.output.error) = false
 * ```
 *
 * @example Data Transformation
 * ```
 * {
 *   "id": trigger.doc.id,
 *   "title": $uppercase(trigger.doc.title),
 *   "tags": trigger.doc.tags[category = "featured"].name
 * }
 * ```
 */

export interface ExpressionContext {
  trigger: Record<string, unknown>
  steps: Record<string, unknown>
  [key: string]: unknown
}

export interface EvaluateOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
}

// Cache compiled expressions for performance
const expressionCache = new Map<string, jsonata.Expression>()
const MAX_CACHE_SIZE = 1000

/**
 * Compile a JSONata expression with caching
 */
function compileExpression(expression: string): jsonata.Expression {
  let compiled = expressionCache.get(expression)

  if (!compiled) {
    compiled = jsonata(expression)

    // Register custom functions
    registerCustomFunctions(compiled)

    // Manage cache size
    if (expressionCache.size >= MAX_CACHE_SIZE) {
      const firstKey = expressionCache.keys().next().value
      if (firstKey) expressionCache.delete(firstKey)
    }

    expressionCache.set(expression, compiled)
  }

  return compiled
}

/**
 * Register custom functions on a JSONata expression
 */
function registerCustomFunctions(expr: jsonata.Expression): void {
  // $env(name) - Get environment variable (only non-sensitive ones)
  expr.registerFunction('env', (name: string) => {
    // Only allow specific prefixes for security
    if (typeof name === 'string' && name.startsWith('PUBLIC_')) {
      return process.env[name]
    }
    return undefined
  }, '<s:s>')

  // $now() - Current ISO timestamp
  expr.registerFunction('now', () => new Date().toISOString(), '<:s>')

  // $timestamp() - Current Unix timestamp in milliseconds
  expr.registerFunction('timestamp', () => Date.now(), '<:n>')

  // $uuid() - Generate a UUID v4
  expr.registerFunction('uuid', () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }, '<:s>')

  // $default(value, defaultValue) - Return default if value is null/undefined
  expr.registerFunction('default', (value: unknown, defaultValue: unknown) => {
    return value === null || value === undefined ? defaultValue : value
  }, '<xx:x>')

  // $json(value) - Parse JSON string
  expr.registerFunction('json', (value: string) => {
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }, '<s:x>')

  // $stringify(value) - Convert to JSON string
  expr.registerFunction('stringify', (value: unknown) => {
    try {
      return JSON.stringify(value)
    } catch {
      return undefined
    }
  }, '<x:s>')

  // $keys(object) - Get object keys
  expr.registerFunction('keys', (obj: Record<string, unknown>) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.keys(obj)
    }
    return []
  }, '<o:a>')

  // $values(object) - Get object values
  expr.registerFunction('values', (obj: Record<string, unknown>) => {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.values(obj)
    }
    return []
  }, '<o:a>')

  // $has(object, key) - Check if object has key
  expr.registerFunction('has', (obj: Record<string, unknown>, key: string) => {
    if (obj && typeof obj === 'object') {
      return key in obj
    }
    return false
  }, '<os:b>')

  // $coalesce(values...) - Return first non-null value
  expr.registerFunction('coalesce', (...values: unknown[]) => {
    for (const v of values) {
      if (v !== null && v !== undefined) {
        return v
      }
    }
    return null
  }, '<x+:x>')
}

/**
 * Evaluate a JSONata expression against a context
 */
export async function evaluate(
  expression: string,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): Promise<unknown> {
  const { timeout = 5000 } = options

  const compiled = compileExpression(expression)

  // Create a promise that rejects on timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Expression evaluation timed out after ${timeout}ms`)), timeout)
  })

  // Race between evaluation and timeout
  return Promise.race([
    compiled.evaluate(context),
    timeoutPromise
  ])
}

/**
 * Evaluate a condition expression and return a boolean
 */
export async function evaluateCondition(
  expression: string,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): Promise<boolean> {
  try {
    const result = await evaluate(expression, context, options)

    // Convert result to boolean
    if (result === undefined || result === null) {
      return false
    }
    if (typeof result === 'boolean') {
      return result
    }
    if (typeof result === 'number') {
      return result !== 0
    }
    if (typeof result === 'string') {
      return result.length > 0
    }
    if (Array.isArray(result)) {
      return result.length > 0
    }
    return true
  } catch (error) {
    // Log error but return false for failed conditions
    console.warn('Condition evaluation failed:', error instanceof Error ? error.message : error)
    return false
  }
}

/**
 * Transform data using a JSONata expression
 * The expression can be a JSONata query or a JSON object with embedded expressions
 */
export async function transform(
  template: unknown,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): Promise<unknown> {
  if (typeof template === 'string') {
    // Check if it looks like a JSONata expression (starts with common patterns)
    if (
      template.startsWith('{') ||
      template.startsWith('[') ||
      template.startsWith('$') ||
      template.includes('.') ||
      template.includes('(')
    ) {
      try {
        return await evaluate(template, context, options)
      } catch {
        // If it fails to evaluate, return as literal string
        return template
      }
    }
    return template
  }

  if (Array.isArray(template)) {
    return Promise.all(template.map(item => transform(item, context, options)))
  }

  if (template && typeof template === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(template)) {
      result[key] = await transform(value, context, options)
    }
    return result
  }

  return template
}

/**
 * Resolve a step input configuration using JSONata
 * Handles both simple values and expressions
 */
export async function resolveStepInput(
  config: Record<string, unknown>,
  context: ExpressionContext,
  options: EvaluateOptions = {}
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config)) {
    result[key] = await transform(value, context, options)
  }

  return result
}

/**
 * Clear the expression cache
 */
export function clearCache(): void {
  expressionCache.clear()
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: expressionCache.size,
    maxSize: MAX_CACHE_SIZE
  }
}
