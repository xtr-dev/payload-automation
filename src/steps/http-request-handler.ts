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
  if (!input || !input.url) {
    throw new Error('URL is required for HTTP request')
  }

  const typedInput = input as HttpRequestInput
  const startTime = Date.now()
  
  // Validate URL
  try {
    new URL(typedInput.url)
  } catch (error) {
    throw new Error(`Invalid URL: ${typedInput.url}`)
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
        state: response.ok ? 'succeeded' : 'failed'
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

  return {
    output: {
      status: 0,
      statusText: 'Request Failed',
      headers: {},
      body: '',
      data: null,
      duration,
      error: finalError.message
    },
    state: 'failed'
  }
}
