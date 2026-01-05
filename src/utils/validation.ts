/**
 * Validation utilities for step handlers.
 * Reduces boilerplate by providing common validation functions.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/**
 * Validates that required fields are present and non-null in the input object.
 * @throws ValidationError if any required field is missing
 */
export function validateRequired<T extends Record<string, unknown>>(
  input: T | null | undefined,
  fields: (keyof T)[]
): asserts input is T {
  if (!input) {
    throw new ValidationError('No input provided')
  }

  for (const field of fields) {
    const value = input[field]
    if (value === undefined || value === null) {
      throw new ValidationError(`${String(field)} is required`)
    }
  }
}

/**
 * Validates that a string field is present and is actually a string.
 * @throws ValidationError if the field is missing or not a string
 */
export function validateString(
  value: unknown,
  fieldName: string
): asserts value is string {
  if (!value || typeof value !== 'string') {
    throw new ValidationError(`${fieldName} is required and must be a string`)
  }
}

/**
 * Validates that a URL is valid.
 * @throws ValidationError if the URL is invalid
 */
export function validateUrl(url: string): void {
  try {
    new URL(url)
  } catch {
    throw new ValidationError(`Invalid URL: ${url}`)
  }
}

/**
 * Validates that the value is a valid email address.
 * Uses a simple regex for basic validation.
 * @throws ValidationError if the email is invalid
 */
export function validateEmail(email: string, fieldName = 'email'): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    throw new ValidationError(`${fieldName} must be a valid email address`)
  }
}

/**
 * Parses a value that might be JSON string or already an object.
 * @returns The parsed object
 * @throws ValidationError if parsing fails
 */
export function parseJsonOrObject<T = unknown>(
  value: string | T,
  fieldName: string
): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      throw new ValidationError(`${fieldName} must be valid JSON`)
    }
  }
  return value as T
}

/**
 * Validates that a number is within a range.
 * @throws ValidationError if the value is out of range
 */
export function validateNumberRange(
  value: number,
  fieldName: string,
  min?: number,
  max?: number
): void {
  if (min !== undefined && value < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`)
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`)
  }
}

/**
 * Creates a standardized failed response for step handlers.
 */
export function createFailedResponse(error: unknown) {
  return {
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
    state: 'failed' as const
  }
}

/**
 * Creates a standardized success response for step handlers.
 */
export function createSuccessResponse<T>(output: T) {
  return {
    output,
    state: 'succeeded' as const
  }
}

/**
 * Wraps a step handler function with automatic error handling.
 * Catches errors and returns standardized failed responses.
 */
export function withErrorHandling<TInput, TOutput>(
  handler: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<{ output: TOutput; state: 'succeeded' } | { errorMessage: string; state: 'failed' }> {
  return async (input: TInput) => {
    try {
      const output = await handler(input)
      return createSuccessResponse(output)
    } catch (error) {
      return createFailedResponse(error)
    }
  }
}
