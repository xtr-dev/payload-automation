import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowExecutor } from '../core/workflow-executor.js'
import type { Payload } from 'payload'

describe('WorkflowExecutor', () => {
  let mockPayload: Payload
  let mockLogger: any
  let executor: WorkflowExecutor

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }

    mockPayload = {
      jobs: {
        queue: vi.fn().mockResolvedValue({ id: 'job-123' }),
        run: vi.fn().mockResolvedValue(undefined)
      },
      create: vi.fn(),
      update: vi.fn(),
      find: vi.fn()
    } as any

    executor = new WorkflowExecutor(mockPayload, mockLogger)
  })

  describe('resolveJSONPathValue', () => {
    it('should resolve simple JSONPath expressions', () => {
      const context = {
        trigger: {
          doc: { id: 'test-id', title: 'Test Title' }
        },
        steps: {}
      }

      const result = (executor as any).resolveJSONPathValue('$.trigger.doc.id', context)
      expect(result).toBe('test-id')
    })

    it('should resolve nested JSONPath expressions', () => {
      const context = {
        trigger: {
          doc: { 
            id: 'test-id',
            nested: { value: 'nested-value' }
          }
        },
        steps: {}
      }

      const result = (executor as any).resolveJSONPathValue('$.trigger.doc.nested.value', context)
      expect(result).toBe('nested-value')
    })

    it('should return original value for non-JSONPath strings', () => {
      const context = { trigger: {}, steps: {} }
      const result = (executor as any).resolveJSONPathValue('plain-string', context)
      expect(result).toBe('plain-string')
    })

    it('should handle missing JSONPath gracefully', () => {
      const context = { trigger: {}, steps: {} }
      const result = (executor as any).resolveJSONPathValue('$.trigger.missing.field', context)
      expect(result).toBe('$.trigger.missing.field') // Should return original if resolution fails
    })
  })

  describe('resolveStepInput', () => {
    it('should resolve all JSONPath expressions in step config', () => {
      const config = {
        url: '$.trigger.data.url',
        message: 'Static message',
        data: {
          id: '$.trigger.doc.id',
          title: '$.trigger.doc.title'
        }
      }

      const context = {
        trigger: {
          doc: { id: 'doc-123', title: 'Doc Title' },
          data: { url: 'https://example.com/webhook' }
        },
        steps: {}
      }

      const result = (executor as any).resolveStepInput(config, context)
      
      expect(result).toEqual({
        url: 'https://example.com/webhook',
        message: 'Static message',
        data: {
          id: 'doc-123',
          title: 'Doc Title'
        }
      })
    })

    it('should handle arrays with JSONPath expressions', () => {
      const config = {
        items: ['$.trigger.doc.id', 'static-value', '$.trigger.doc.title']
      }

      const context = {
        trigger: {
          doc: { id: 'doc-123', title: 'Doc Title' }
        },
        steps: {}
      }

      const result = (executor as any).resolveStepInput(config, context)
      
      expect(result).toEqual({
        items: ['doc-123', 'static-value', 'Doc Title']
      })
    })
  })

  describe('resolveExecutionOrder', () => {
    it('should handle steps without dependencies', () => {
      const steps = [
        { name: 'step1', step: 'http-request' },
        { name: 'step2', step: 'create-document' },
        { name: 'step3', step: 'http-request' }
      ]

      const result = (executor as any).resolveExecutionOrder(steps)
      
      expect(result).toHaveLength(1) // All in one batch
      expect(result[0]).toHaveLength(3) // All steps in first batch
    })

    it('should handle steps with dependencies', () => {
      const steps = [
        { name: 'step1', step: 'http-request' },
        { name: 'step2', step: 'create-document', dependencies: ['step1'] },
        { name: 'step3', step: 'http-request', dependencies: ['step2'] }
      ]

      const result = (executor as any).resolveExecutionOrder(steps)
      
      expect(result).toHaveLength(3) // Three batches
      expect(result[0]).toHaveLength(1) // step1 first
      expect(result[1]).toHaveLength(1) // step2 second
      expect(result[2]).toHaveLength(1) // step3 third
    })

    it('should handle parallel execution with partial dependencies', () => {
      const steps = [
        { name: 'step1', step: 'http-request' },
        { name: 'step2', step: 'create-document' },
        { name: 'step3', step: 'http-request', dependencies: ['step1'] },
        { name: 'step4', step: 'create-document', dependencies: ['step1'] }
      ]

      const result = (executor as any).resolveExecutionOrder(steps)
      
      expect(result).toHaveLength(2) // Two batches
      expect(result[0]).toHaveLength(2) // step1 and step2 in parallel
      expect(result[1]).toHaveLength(2) // step3 and step4 in parallel
    })

    it('should detect circular dependencies', () => {
      const steps = [
        { name: 'step1', step: 'http-request', dependencies: ['step2'] },
        { name: 'step2', step: 'create-document', dependencies: ['step1'] }
      ]

      expect(() => {
        (executor as any).resolveExecutionOrder(steps)
      }).toThrow('Circular dependency detected')
    })
  })

  describe('evaluateCondition', () => {
    it('should evaluate simple equality conditions', () => {
      const context = {
        trigger: {
          doc: { status: 'published' }
        },
        steps: {}
      }

      const result = (executor as any).evaluateCondition('$.trigger.doc.status == "published"', context)
      expect(result).toBe(true)
    })

    it('should evaluate inequality conditions', () => {
      const context = {
        trigger: {
          doc: { count: 5 }
        },
        steps: {}
      }

      const result = (executor as any).evaluateCondition('$.trigger.doc.count > 3', context)
      expect(result).toBe(true)
    })

    it('should return false for invalid conditions', () => {
      const context = { trigger: {}, steps: {} }
      const result = (executor as any).evaluateCondition('invalid condition syntax', context)
      expect(result).toBe(false)
    })

    it('should handle missing context gracefully', () => {
      const context = { trigger: {}, steps: {} }
      const result = (executor as any).evaluateCondition('$.trigger.doc.status == "published"', context)
      expect(result).toBe(false) // Missing values should fail condition
    })
  })

  describe('safeSerialize', () => {
    it('should serialize simple objects', () => {
      const obj = { name: 'test', value: 123 }
      const result = (executor as any).safeSerialize(obj)
      expect(result).toBe('{"name":"test","value":123}')
    })

    it('should handle circular references', () => {
      const obj: any = { name: 'test' }
      obj.self = obj // Create circular reference

      const result = (executor as any).safeSerialize(obj)
      expect(result).toContain('"name":"test"')
      expect(result).toContain('"self":"[Circular]"')
    })

    it('should handle undefined and null values', () => {
      const obj = { 
        defined: 'value',
        undefined: undefined,
        null: null
      }
      
      const result = (executor as any).safeSerialize(obj)
      const parsed = JSON.parse(result)
      expect(parsed.defined).toBe('value')
      expect(parsed.null).toBe(null)
      expect(parsed).not.toHaveProperty('undefined') // undefined props are omitted
    })
  })

  describe('executeWorkflow', () => {
    it('should execute workflow with single step', async () => {
      const workflow = {
        id: 'test-workflow',
        steps: [
          {
            name: 'test-step',
            step: 'http-request-step',
            url: 'https://example.com',
            method: 'GET'
          }
        ]
      }
      
      const context = {
        trigger: { doc: { id: 'test-doc' } },
        steps: {}
      }

      // Mock step task
      const mockStepTask = {
        taskSlug: 'http-request-step',
        handler: vi.fn().mockResolvedValue({
          output: { status: 200, body: 'success' },
          state: 'succeeded'
        })
      }

      // Mock the step tasks registry
      const originalStepTasks = (executor as any).stepTasks
      ;(executor as any).stepTasks = [mockStepTask]

      const result = await (executor as any).executeWorkflow(workflow, context)

      expect(result.status).toBe('completed')
      expect(result.context.steps['test-step']).toBeDefined()
      expect(result.context.steps['test-step'].state).toBe('succeeded')
      expect(mockStepTask.handler).toHaveBeenCalledOnce()

      // Restore original step tasks
      ;(executor as any).stepTasks = originalStepTasks
    })

    it('should handle step execution failures', async () => {
      const workflow = {
        id: 'test-workflow',
        steps: [
          {
            name: 'failing-step',
            step: 'http-request-step',
            url: 'https://invalid-url',
            method: 'GET'
          }
        ]
      }
      
      const context = {
        trigger: { doc: { id: 'test-doc' } },
        steps: {}
      }

      // Mock failing step task
      const mockStepTask = {
        taskSlug: 'http-request-step',
        handler: vi.fn().mockRejectedValue(new Error('Network error'))
      }

      const originalStepTasks = (executor as any).stepTasks
      ;(executor as any).stepTasks = [mockStepTask]

      const result = await (executor as any).executeWorkflow(workflow, context)

      expect(result.status).toBe('failed')
      expect(result.error).toContain('Network error')
      expect(result.context.steps['failing-step']).toBeDefined()
      expect(result.context.steps['failing-step'].state).toBe('failed')

      ;(executor as any).stepTasks = originalStepTasks
    })

    it('should execute steps with dependencies in correct order', async () => {
      const workflow = {
        id: 'test-workflow',
        steps: [
          {
            name: 'step1',
            step: 'http-request-step',
            url: 'https://example.com/1',
            method: 'GET'
          },
          {
            name: 'step2',
            step: 'http-request-step',
            url: 'https://example.com/2',
            method: 'GET',
            dependencies: ['step1']
          },
          {
            name: 'step3',
            step: 'http-request-step',
            url: 'https://example.com/3',
            method: 'GET',
            dependencies: ['step1']
          }
        ]
      }
      
      const context = {
        trigger: { doc: { id: 'test-doc' } },
        steps: {}
      }

      const executionOrder: string[] = []
      const mockStepTask = {
        taskSlug: 'http-request-step',
        handler: vi.fn().mockImplementation(async ({ input }) => {
          executionOrder.push(input.stepName)
          return {
            output: { status: 200, body: 'success' },
            state: 'succeeded'
          }
        })
      }

      const originalStepTasks = (executor as any).stepTasks
      ;(executor as any).stepTasks = [mockStepTask]

      const result = await (executor as any).executeWorkflow(workflow, context)

      expect(result.status).toBe('completed')
      expect(executionOrder[0]).toBe('step1') // First step executed first
      expect(executionOrder.slice(1)).toContain('step2') // Dependent steps after
      expect(executionOrder.slice(1)).toContain('step3')

      ;(executor as any).stepTasks = originalStepTasks
    })
  })

  describe('findStepTask', () => {
    it('should find registered step task by slug', () => {
      const mockStepTask = {
        taskSlug: 'test-step',
        handler: vi.fn()
      }

      const originalStepTasks = (executor as any).stepTasks
      ;(executor as any).stepTasks = [mockStepTask]

      const result = (executor as any).findStepTask('test-step')
      expect(result).toBe(mockStepTask)

      ;(executor as any).stepTasks = originalStepTasks
    })

    it('should return undefined for unknown step type', () => {
      const result = (executor as any).findStepTask('unknown-step')
      expect(result).toBeUndefined()
    })
  })

  describe('validateStepConfiguration', () => {
    it('should validate step with required fields', () => {
      const step = {
        name: 'valid-step',
        step: 'http-request-step',
        url: 'https://example.com',
        method: 'GET'
      }

      expect(() => {
        (executor as any).validateStepConfiguration(step)
      }).not.toThrow()
    })

    it('should throw error for step without name', () => {
      const step = {
        step: 'http-request-step',
        url: 'https://example.com',
        method: 'GET'
      }

      expect(() => {
        (executor as any).validateStepConfiguration(step)
      }).toThrow('Step name is required')
    })

    it('should throw error for step without type', () => {
      const step = {
        name: 'test-step',
        url: 'https://example.com',
        method: 'GET'
      }

      expect(() => {
        (executor as any).validateStepConfiguration(step)
      }).toThrow('Step type is required')
    })
  })

  describe('createExecutionContext', () => {
    it('should create context with trigger data', () => {
      const triggerContext = {
        operation: 'create',
        doc: { id: 'test-id', title: 'Test Doc' },
        collection: 'posts'
      }

      const result = (executor as any).createExecutionContext(triggerContext)

      expect(result.trigger).toEqual(triggerContext)
      expect(result.steps).toEqual({})
      expect(result.metadata).toBeDefined()
      expect(result.metadata.startedAt).toBeDefined()
    })

    it('should include metadata in context', () => {
      const triggerContext = { doc: { id: 'test' } }
      const result = (executor as any).createExecutionContext(triggerContext)

      expect(result.metadata).toHaveProperty('startedAt')
      expect(result.metadata).toHaveProperty('executionId')
      expect(typeof result.metadata.executionId).toBe('string')
    })
  })
})