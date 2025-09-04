import { describe, it, expect, vi, beforeEach } from 'vitest'
import { httpRequestStepHandler } from '../steps/http-request-handler.js'
import type { Payload } from 'payload'

// Mock fetch globally
global.fetch = vi.fn()

describe('HttpRequestStepHandler', () => {
  let mockPayload: Payload
  let mockReq: any

  beforeEach(() => {
    mockPayload = {} as Payload
    mockReq = {
      payload: mockPayload,
      user: null
    }
    vi.clearAllMocks()
  })

  describe('GET requests', () => {
    it('should handle successful GET request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue('{"success": true}')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/data',
        method: 'GET' as const,
        stepName: 'test-get-step'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.status).toBe(200)
      expect(result.output.statusText).toBe('OK')
      expect(result.output.body).toBe('{"success": true}')
      expect(result.output.headers).toEqual({ 'content-type': 'application/json' })

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', {
        method: 'GET',
        headers: {},
        signal: expect.any(AbortSignal)
      })
    })

    it('should handle GET request with custom headers', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('success')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/data',
        method: 'GET' as const,
        headers: {
          'Authorization': 'Bearer token123',
          'User-Agent': 'PayloadCMS-Workflow/1.0'
        },
        stepName: 'test-get-with-headers'
      }

      await httpRequestStepHandler({ input, req: mockReq })

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer token123',
          'User-Agent': 'PayloadCMS-Workflow/1.0'
        },
        signal: expect.any(AbortSignal)
      })
    })
  })

  describe('POST requests', () => {
    it('should handle POST request with JSON body', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('{"id": "123"}')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/posts',
        method: 'POST' as const,
        body: { title: 'Test Post', content: 'Test content' },
        headers: { 'Content-Type': 'application/json' },
        stepName: 'test-post-step'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.status).toBe(201)

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Post', content: 'Test content' }),
        signal: expect.any(AbortSignal)
      })
    })

    it('should handle POST request with string body', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('OK')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/webhook',
        method: 'POST' as const,
        body: 'plain text data',
        headers: { 'Content-Type': 'text/plain' },
        stepName: 'test-post-string'
      }

      await httpRequestStepHandler({ input, req: mockReq })

      expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'plain text data',
        signal: expect.any(AbortSignal)
      })
    })
  })

  describe('Error handling', () => {
    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      const input = {
        url: 'https://invalid-url.example.com',
        method: 'GET' as const,
        stepName: 'test-network-error'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Network error')
    })

    it('should handle HTTP error status codes', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: vi.fn().mockResolvedValue('Page not found')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/nonexistent',
        method: 'GET' as const,
        stepName: 'test-404-error'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('HTTP 404')
      expect(result.output.status).toBe(404)
      expect(result.output.statusText).toBe('Not Found')
    })

    it('should handle timeout errors', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      ;(global.fetch as any).mockRejectedValue(abortError)

      const input = {
        url: 'https://slow-api.example.com',
        method: 'GET' as const,
        timeout: 1000,
        stepName: 'test-timeout'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('timeout')
    })

    it('should handle invalid JSON response parsing', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue('invalid json {')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/invalid-json',
        method: 'GET' as const,
        stepName: 'test-invalid-json'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      // Should still succeed but with raw text body
      expect(result.state).toBe('succeeded')
      expect(result.output.body).toBe('invalid json {')
    })
  })

  describe('Request validation', () => {
    it('should validate required URL field', async () => {
      const input = {
        method: 'GET' as const,
        stepName: 'test-missing-url'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq } as any)

      expect(result.state).toBe('failed')
      expect(result.error).toContain('URL is required')
    })

    it('should validate HTTP method', async () => {
      const input = {
        url: 'https://api.example.com',
        method: 'INVALID' as any,
        stepName: 'test-invalid-method'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Invalid HTTP method')
    })

    it('should validate URL format', async () => {
      const input = {
        url: 'not-a-valid-url',
        method: 'GET' as const,
        stepName: 'test-invalid-url'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Invalid URL')
    })
  })

  describe('Response processing', () => {
    it('should parse JSON responses automatically', async () => {
      const responseData = { id: 123, name: 'Test Item' }
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue(JSON.stringify(responseData))
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/item/123',
        method: 'GET' as const,
        stepName: 'test-json-parsing'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(typeof result.output.body).toBe('string')
      // Should contain the JSON as string for safe storage
      expect(result.output.body).toBe(JSON.stringify(responseData))
    })

    it('should handle non-JSON responses', async () => {
      const htmlContent = '<html><body>Hello World</body></html>'
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/html' }),
        text: vi.fn().mockResolvedValue(htmlContent)
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://example.com/page',
        method: 'GET' as const,
        stepName: 'test-html-response'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.body).toBe(htmlContent)
    })

    it('should capture response headers', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'application/json',
          'x-rate-limit': '100',
          'x-custom-header': 'custom-value'
        }),
        text: vi.fn().mockResolvedValue('{}')
      }
      ;(global.fetch as any).mockResolvedValue(mockResponse)

      const input = {
        url: 'https://api.example.com/data',
        method: 'GET' as const,
        stepName: 'test-response-headers'
      }

      const result = await httpRequestStepHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.headers).toEqual({
        'content-type': 'application/json',
        'x-rate-limit': '100',
        'x-custom-header': 'custom-value'
      })
    })
  })
})