import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDocumentHandler } from '../steps/create-document-handler.js'
import type { Payload } from 'payload'

describe('CreateDocumentStepHandler', () => {
  let mockPayload: Payload
  let mockReq: any

  beforeEach(() => {
    mockPayload = {
      create: vi.fn()
    } as any

    mockReq = {
      payload: mockPayload,
      user: { id: 'user-123', email: 'test@example.com' }
    }
    vi.clearAllMocks()
  })

  describe('Document creation', () => {
    it('should create document successfully', async () => {
      const createdDoc = {
        id: 'doc-123',
        title: 'Test Document',
        content: 'Test content'
      }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'posts',
        data: {
          title: 'Test Document',
          content: 'Test content'
        },
        stepName: 'test-create-step'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.document).toEqual(createdDoc)
      expect(result.output.id).toBe('doc-123')

      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'posts',
        data: {
          title: 'Test Document',
          content: 'Test content'
        },
        req: mockReq
      })
    })

    it('should create document with relationship fields', async () => {
      const createdDoc = {
        id: 'doc-456',
        title: 'Related Document',
        author: 'user-123',
        category: 'cat-789'
      }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'articles',
        data: {
          title: 'Related Document',
          author: 'user-123',
          category: 'cat-789'
        },
        stepName: 'test-create-with-relations'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.document).toEqual(createdDoc)
      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'articles',
        data: {
          title: 'Related Document',
          author: 'user-123',
          category: 'cat-789'
        },
        req: mockReq
      })
    })

    it('should create document with complex nested data', async () => {
      const complexData = {
        title: 'Complex Document',
        metadata: {
          tags: ['tag1', 'tag2'],
          settings: {
            featured: true,
            priority: 5
          }
        },
        blocks: [
          { type: 'text', content: 'Text block' },
          { type: 'image', src: 'image.jpg', alt: 'Test image' }
        ]
      }

      const createdDoc = { id: 'doc-complex', ...complexData }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'pages',
        data: complexData,
        stepName: 'test-create-complex'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.document).toEqual(createdDoc)
      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'pages',
        data: complexData,
        req: mockReq
      })
    })
  })

  describe('Error handling', () => {
    it('should handle PayloadCMS validation errors', async () => {
      const validationError = new Error('Validation failed')
      ;(validationError as any).data = [
        {
          message: 'Title is required',
          path: 'title',
          value: undefined
        }
      ]
      ;(mockPayload.create as any).mockRejectedValue(validationError)

      const input = {
        collectionSlug: 'posts',
        data: {
          content: 'Missing title'
        },
        stepName: 'test-validation-error'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Validation failed')
    })

    it('should handle permission errors', async () => {
      const permissionError = new Error('Insufficient permissions')
      ;(permissionError as any).status = 403
      ;(mockPayload.create as any).mockRejectedValue(permissionError)

      const input = {
        collectionSlug: 'admin-only',
        data: {
          secret: 'confidential data'
        },
        stepName: 'test-permission-error'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Insufficient permissions')
    })

    it('should handle database connection errors', async () => {
      const dbError = new Error('Database connection failed')
      ;(mockPayload.create as any).mockRejectedValue(dbError)

      const input = {
        collectionSlug: 'posts',
        data: { title: 'Test' },
        stepName: 'test-db-error'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Database connection failed')
    })

    it('should handle unknown collection errors', async () => {
      const collectionError = new Error('Collection "unknown" not found')
      ;(mockPayload.create as any).mockRejectedValue(collectionError)

      const input = {
        collectionSlug: 'unknown-collection',
        data: { title: 'Test' },
        stepName: 'test-unknown-collection'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Collection "unknown" not found')
    })
  })

  describe('Input validation', () => {
    it('should validate required collection slug', async () => {
      const input = {
        data: { title: 'Test' },
        stepName: 'test-missing-collection'
      }

      const result = await createDocumentStepHandler({ input, req: mockReq } as any)

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Collection slug is required')
    })

    it('should validate required data field', async () => {
      const input = {
        collectionSlug: 'posts',
        stepName: 'test-missing-data'
      }

      const result = await createDocumentStepHandler({ input, req: mockReq } as any)

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Data is required')
    })

    it('should validate data is an object', async () => {
      const input = {
        collectionSlug: 'posts',
        data: 'invalid-data-type',
        stepName: 'test-invalid-data-type'
      }

      const result = await createDocumentStepHandler({ input, req: mockReq } as any)

      expect(result.state).toBe('failed')
      expect(result.error).toContain('Data must be an object')
    })

    it('should handle empty data object', async () => {
      const createdDoc = { id: 'empty-doc' }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'posts',
        data: {},
        stepName: 'test-empty-data'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result.state).toBe('succeeded')
      expect(result.output.document).toEqual(createdDoc)
      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'posts',
        data: {},
        req: mockReq
      })
    })
  })

  describe('Request context', () => {
    it('should pass user context from request', async () => {
      const createdDoc = { id: 'user-doc', title: 'User Document' }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'posts',
        data: { title: 'User Document' },
        stepName: 'test-user-context'
      }

      await createDocumentStepHandler({ input, req: mockReq })

      const createCall = (mockPayload.create as any).mock.calls[0][0]
      expect(createCall.req).toBe(mockReq)
      expect(createCall.req.user).toEqual({
        id: 'user-123',
        email: 'test@example.com'
      })
    })

    it('should handle requests without user context', async () => {
      const reqWithoutUser = {
        payload: mockPayload,
        user: null
      }

      const createdDoc = { id: 'anonymous-doc' }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'posts',
        data: { title: 'Anonymous Document' },
        stepName: 'test-anonymous'
      }

      const result = await createDocumentStepHandler({ input, req: reqWithoutUser })

      expect(result.state).toBe('succeeded')
      expect(mockPayload.create).toHaveBeenCalledWith({
        collection: 'posts',
        data: { title: 'Anonymous Document' },
        req: reqWithoutUser
      })
    })
  })

  describe('Output structure', () => {
    it('should return correct output structure on success', async () => {
      const createdDoc = {
        id: 'output-test-doc',
        title: 'Output Test',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z'
      }
      ;(mockPayload.create as any).mockResolvedValue(createdDoc)

      const input = {
        collectionSlug: 'posts',
        data: { title: 'Output Test' },
        stepName: 'test-output-structure'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result).toEqual({
        state: 'succeeded',
        output: {
          document: createdDoc,
          id: 'output-test-doc'
        }
      })
    })

    it('should return correct error structure on failure', async () => {
      const error = new Error('Test error')
      ;(mockPayload.create as any).mockRejectedValue(error)

      const input = {
        collectionSlug: 'posts',
        data: { title: 'Error Test' },
        stepName: 'test-error-structure'
      }

      const result = await createDocumentHandler({ input, req: mockReq })

      expect(result).toEqual({
        state: 'failed',
        error: 'Test error'
      })
    })
  })
})