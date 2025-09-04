import nock from 'nock'

/**
 * Mock HTTP requests to httpbin.org for testing
 */
export const mockHttpBin = {
  /**
   * Mock a successful POST request to httpbin.org/post
   */
  mockPost: (expectedData?: any) => {
    return nock('https://httpbin.org')
      .post('/post')
      .reply(200, {
        args: {},
        data: JSON.stringify(expectedData || {}),
        files: {},
        form: {},
        headers: {
          'Accept': '*/*',
          'Accept-Encoding': 'br, gzip, deflate',
          'Accept-Language': '*',
          'Content-Type': 'application/json',
          'Host': 'httpbin.org',
          'Sec-Fetch-Mode': 'cors',
          'User-Agent': 'PayloadCMS-Automation/1.0'
        },
        json: expectedData || {},
        origin: '127.0.0.1',
        url: 'https://httpbin.org/post'
      }, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true'
      })
  },

  /**
   * Mock a GET request to httpbin.org/get
   */
  mockGet: () => {
    return nock('https://httpbin.org')
      .get('/get')
      .reply(200, {
        args: {},
        headers: {
          'Accept': '*/*',
          'Host': 'httpbin.org',
          'User-Agent': 'PayloadCMS-Automation/1.0'
        },
        origin: '127.0.0.1',
        url: 'https://httpbin.org/get'
      })
  },

  /**
   * Mock HTTP timeout
   */
  mockTimeout: (path: string = '/delay/10') => {
    return nock('https://httpbin.org')
      .get(path)
      .replyWithError({
        code: 'ECONNABORTED',
        message: 'timeout of 2000ms exceeded'
      })
  },

  /**
   * Mock HTTP error responses
   */
  mockError: (status: number, path: string = '/status/' + status) => {
    return nock('https://httpbin.org')
      .get(path)
      .reply(status, {
        error: `HTTP ${status} Error`,
        message: `Mock ${status} response`
      })
  },

  /**
   * Mock invalid URL to simulate network errors
   */
  mockNetworkError: (url: string = 'invalid-url-that-will-fail') => {
    return nock('https://' + url)
      .get('/')
      .replyWithError({
        code: 'ENOTFOUND',
        message: `getaddrinfo ENOTFOUND ${url}`
      })
  },

  /**
   * Mock HTML response (non-JSON)
   */
  mockHtml: () => {
    return nock('https://httpbin.org')
      .get('/html')
      .reply(200, '<!DOCTYPE html><html><head><title>Test</title></head><body>Test HTML</body></html>', {
        'Content-Type': 'text/html'
      })
  },

  /**
   * Mock all common endpoints for error scenarios
   */
  mockAllErrorScenarios: () => {
    // HTML response for invalid JSON test
    nock('https://httpbin.org')
      .get('/html')
      .reply(200, '<!DOCTYPE html><html><head><title>Test</title></head><body>Test HTML</body></html>', {
        'Content-Type': 'text/html'
      })

    // 404 error
    nock('https://httpbin.org')
      .get('/status/404')
      .reply(404, {
        error: 'Not Found',
        message: 'The requested resource was not found'
      })

    // 500 error  
    nock('https://httpbin.org')
      .get('/status/500')
      .reply(500, {
        error: 'Internal Server Error',
        message: 'Server encountered an error'
      })

    // 503 error for retry tests
    nock('https://httpbin.org')
      .get('/status/503')
      .times(3) // Allow 3 retries
      .reply(503, {
        error: 'Service Unavailable',
        message: 'Service is temporarily unavailable'
      })

    // POST endpoint for circular reference and other POST tests
    nock('https://httpbin.org')
      .post('/post')
      .times(5) // Allow multiple POST requests
      .reply(200, (uri, requestBody) => ({
        args: {},
        data: JSON.stringify(requestBody),
        json: requestBody,
        url: 'https://httpbin.org/post'
      }))
  },

  /**
   * Clean up all nock mocks
   */
  cleanup: () => {
    nock.cleanAll()
  }
}

/**
 * Test fixtures for common workflow configurations
 */
export const testFixtures = {
  basicWorkflow: {
    name: 'Test Basic Workflow',
    description: 'Basic workflow for testing',
    triggers: [
      {
        type: 'collection-trigger' as const,
        collectionSlug: 'posts',
        operation: 'create' as const
      }
    ]
  },

  httpRequestStep: (url: string = 'https://httpbin.org/post', expectedData?: any) => ({
    name: 'http-request',
    step: 'http-request-step',
    url,
    method: 'POST' as const,
    headers: {
      'Content-Type': 'application/json'
    },
    body: expectedData || {
      message: 'Test request',
      data: '$.trigger.doc'
    }
  }),

  createDocumentStep: (collectionSlug: string = 'auditLog') => ({
    name: 'create-audit',
    step: 'create-document',
    collectionSlug,
    data: {
      message: 'Test document created',
      sourceId: '$.trigger.doc.id'
    }
  }),

  testPost: {
    content: 'Test post content for workflow trigger'
  }
}