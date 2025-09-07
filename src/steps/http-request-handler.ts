import type {TaskHandler} from "payload"

interface HttpRequestInput {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: any
  timeout?: number
  authentication?: {
    type?: 'none' | 'bearer' | 'basic' | 'apikey'
    token?: string
    username?: string
    password?: string
    headerName?: string
    headerValue?: string
  }
  retries?: number
  retryDelay?: number
}

export const httpStepHandler: TaskHandler<'http-request-step'> = async ({input, req}) => {
  const startTime = Date.now() // Move startTime to outer scope
  
  try {
    if (!input || !input.url) {
      return {
        output: {
          status: 0,
          statusText: 'Invalid Input',
          headers: {},
          body: '',
          data: null,
          duration: 0,
          error: 'URL is required for HTTP request'
        },
        state: 'failed'
      }
    }

  const typedInput = input as HttpRequestInput
  
    // Validate URL
    try {
      new URL(typedInput.url)
    } catch (error) {
      return {
        output: {
          status: 0,
          statusText: 'Invalid URL',
          headers: {},
          body: '',
          data: null,
          duration: 0,
          error: `Invalid URL: ${typedInput.url}`
        },
        state: 'failed'
      }
    }

  // Prepare request options
  const method = (typedInput.method || 'GET').toUpperCase()
  const timeout = typedInput.timeout || 30000
  const headers: Record<string, string> = {
    'User-Agent': 'PayloadCMS-Automation/1.0',
    ...typedInput.headers
  }

  // Handle authentication
  if (typedInput.authentication) {
    switch (typedInput.authentication.type) {
      case 'bearer':
        if (typedInput.authentication.token) {
          headers['Authorization'] = `Bearer ${typedInput.authentication.token}`
        }
        break
      case 'basic':
        if (typedInput.authentication.username && typedInput.authentication.password) {
          const credentials = btoa(`${typedInput.authentication.username}:${typedInput.authentication.password}`)
          headers['Authorization'] = `Basic ${credentials}`
        }
        break
      case 'apikey':
        if (typedInput.authentication.headerName && typedInput.authentication.headerValue) {
          headers[typedInput.authentication.headerName] = typedInput.authentication.headerValue
        }
        break
    }
  }

  // Prepare request body
  let requestBody: string | undefined
  if (['POST', 'PUT', 'PATCH'].includes(method) && typedInput.body) {
    if (typeof typedInput.body === 'string') {
      requestBody = typedInput.body
    } else {
      requestBody = JSON.stringify(typedInput.body)
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json'
      }
    }
  }

  // Create abort controller for timeout
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => abortController.abort(), timeout)

  // Retry logic
  const maxRetries = Math.min(Math.max(typedInput.retries || 0, 0), 5)
  const retryDelay = Math.max(typedInput.retryDelay || 1000, 100)

  let lastError: Error | null = null
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Add delay for retry attempts
      if (attempt > 0) {
        req?.payload?.logger?.info({
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          url: typedInput.url,
          delay: retryDelay
        }, 'HTTP request retry attempt')
        
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }

      const response = await fetch(typedInput.url, {
        method,
        headers,
        body: requestBody,
        signal: abortController.signal
      })

      clearTimeout(timeoutId)
      const duration = Date.now() - startTime

      // Parse response
      const responseText = await response.text()
      let parsedData: any = null

      try {
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json') || contentType.includes('text/json')) {
          parsedData = JSON.parse(responseText)
        }
      } catch (parseError) {
        // Not JSON, that's fine
      }

      // Convert headers to plain object
      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value
      })

      const output = {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseText,
        data: parsedData,
        duration
      }

      req?.payload?.logger?.info({
        url: typedInput.url,
        method,
        status: response.status,
        duration,
        attempt: attempt + 1
      }, 'HTTP request completed')

      return {
        output,
        // Always return 'succeeded' for completed HTTP requests, even with error status codes (4xx/5xx).
        // This preserves error information in the output for workflow conditional logic.
        // Only network errors, timeouts, and connection failures should result in 'failed' state.
        // This design allows workflows to handle HTTP errors gracefully rather than failing completely.
        state: 'succeeded'
      }

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')
      
      // Handle specific error types
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`)
        } else if (error.message.includes('fetch')) {
          lastError = new Error(`Network error: ${error.message}`)
        }
      }

      req?.payload?.logger?.warn({
        url: typedInput.url,
        method,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        error: lastError.message
      }, 'HTTP request attempt failed')

      // Don't retry on certain errors
      if (lastError.message.includes('Invalid URL') || 
          lastError.message.includes('TypeError') ||
          attempt >= maxRetries) {
        break
      }
    }
  }

  clearTimeout(timeoutId)
  const duration = Date.now() - startTime

  // All retries exhausted
  const finalError = lastError || new Error('HTTP request failed')
  
  req?.payload?.logger?.error({
    url: typedInput.url,
    method,
    totalAttempts: maxRetries + 1,
    duration,
    error: finalError.message
  }, 'HTTP request failed after all retries')

    // Include detailed error information in the output
    // Even though PayloadCMS will discard this for failed tasks,
    // we include it here for potential future PayloadCMS improvements
    const errorDetails = {
      errorType: finalError.message.includes('timeout') ? 'timeout' : 
               finalError.message.includes('ENOTFOUND') ? 'dns' :
               finalError.message.includes('ECONNREFUSED') ? 'connection' : 'network',
      duration,
      attempts: maxRetries + 1,
      finalError: finalError.message,
      context: {
        url: typedInput.url,
        method,
        timeout: typedInput.timeout,
        headers: typedInput.headers
      }
    }

    // Return comprehensive output (PayloadCMS will discard it for failed state, but we try anyway)
    return {
      output: {
        status: 0,
        statusText: 'Request Failed',
        headers: {},
        body: '',
        data: null,
        duration,
        error: finalError.message,
        errorDetails // Include detailed error info (will be discarded by PayloadCMS)
      },
      state: 'failed'
    }
  } catch (unexpectedError) {
    // Handle any unexpected errors that weren't caught above
    const error = unexpectedError instanceof Error ? unexpectedError : new Error('Unexpected error')
    
    req?.payload?.logger?.error({
      error: error.message,
      stack: error.stack,
      input: (input as any)?.url || 'unknown'
    }, 'Unexpected error in HTTP request handler')

    return {
      output: {
        status: 0,
        statusText: 'Handler Error',
        headers: {},
        body: '',
        data: null,
        duration: Date.now() - startTime,
        error: `HTTP request handler error: ${error.message}`
      },
      state: 'failed'
    }
  }
}
