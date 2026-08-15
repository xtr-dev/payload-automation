import { beforeEach, describe, expect, it, vi } from 'vitest'

// WorkflowExecutor talks to a real Payload/db instance internally (payload.create
// for workflow-runs, step resolution, etc.), which this harness has no Payload
// instance to back. The endpoint's own job — auth, path matching, secret
// redaction — is fully exercised by controlling what WorkflowExecutor does
// without executing it for real, so it is mocked at the module boundary.
const { executeMock, evaluateConditionMock, WorkflowExecutorMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  evaluateConditionMock: vi.fn(),
  WorkflowExecutorMock: vi.fn(),
}))

vi.mock('../core/workflow-executor.js', () => ({
  WorkflowExecutor: WorkflowExecutorMock,
}))

const { webhookEndpoint } = await import('./webhook-endpoint.js')

const webhookTrigger = {
  id: 't1',
  name: 'Order webhook',
  condition: null,
  type: 'webhook',
  webhookPath: 'orders',
  webhookSecret: 'correct-secret',
}

const matchingWorkflow = {
  id: 'w1',
  name: 'Order workflow',
  enabled: true,
  steps: [],
  triggers: [{ id: 't1' }],
}

function createMockPayload(overrides: { triggers?: unknown[]; workflows?: unknown[] } = {}) {
  const find = vi.fn(({ collection }: { collection: string }) => {
    if (collection === 'automation-triggers') {
      return { docs: overrides.triggers ?? [] }
    }
    if (collection === 'workflows') {
      return { docs: overrides.workflows ?? [] }
    }
    throw new Error(`Unexpected collection queried in test: ${collection}`)
  })
  const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  return { find, logger }
}

function createRequest({
  headers = {},
  payload,
  webhookPath,
}: {
  headers?: Record<string, string>
  payload: ReturnType<typeof createMockPayload>
  webhookPath?: string
}) {
  const headerMap = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
  return {
    headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
    json: () => null,
    payload,
    routeParams: webhookPath === undefined ? {} : { webhookPath },
    url: 'http://localhost/api/automation/webhooks/orders',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

beforeEach(() => {
  executeMock.mockReset().mockResolvedValue(undefined)
  evaluateConditionMock.mockReset().mockResolvedValue(true)
  WorkflowExecutorMock.mockReset().mockImplementation(() => ({
    evaluateCondition: evaluateConditionMock,
    execute: executeMock,
  }))
})

describe('webhookEndpoint', () => {
  it('returns 404 when no webhook path segment is present', async () => {
    const payload = createMockPayload()
    const res = await webhookEndpoint.handler(createRequest({ payload, webhookPath: undefined }))

    expect(res.status).toBe(404)
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('returns 404 when the path matches no webhook trigger', async () => {
    const payload = createMockPayload({ triggers: [] })
    const res = await webhookEndpoint.handler(
      createRequest({ payload, webhookPath: 'unknown-path' })
    )

    expect(res.status).toBe(404)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('returns 401 and runs nothing when no secret is provided', async () => {
    const payload = createMockPayload({ triggers: [webhookTrigger] })
    const res = await webhookEndpoint.handler(createRequest({ payload, webhookPath: 'orders' }))

    expect(res.status).toBe(401)
    expect(executeMock).not.toHaveBeenCalled()
    expect(payload.find).toHaveBeenCalledTimes(1)
    expect(payload.find).not.toHaveBeenCalledWith(expect.objectContaining({ collection: 'workflows' }))
  })

  it('returns 401 and runs nothing when the secret is wrong', async () => {
    const payload = createMockPayload({ triggers: [webhookTrigger] })
    const res = await webhookEndpoint.handler(
      createRequest({
        headers: { 'x-webhook-secret': 'wrong-secret' },
        payload,
        webhookPath: 'orders',
      })
    )

    expect(res.status).toBe(401)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('returns 200 and triggers the workflow when the secret header matches', async () => {
    const payload = createMockPayload({
      triggers: [webhookTrigger],
      workflows: [matchingWorkflow],
    })
    const res = await webhookEndpoint.handler(
      createRequest({
        headers: { 'x-webhook-secret': 'correct-secret' },
        payload,
        webhookPath: 'orders',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(body.workflows).toEqual([
      { status: 'triggered', workflowId: 'w1', workflowName: 'Order workflow' },
    ])
  })

  it('returns 200 when the secret is provided as an Authorization bearer token', async () => {
    const payload = createMockPayload({
      triggers: [webhookTrigger],
      workflows: [matchingWorkflow],
    })
    const res = await webhookEndpoint.handler(
      createRequest({
        headers: { authorization: 'Bearer correct-secret' },
        payload,
        webhookPath: 'orders',
      })
    )

    expect(res.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
  })

  it('never hands the webhook secret to the run context or the executed trigger', async () => {
    const payload = createMockPayload({
      triggers: [webhookTrigger],
      workflows: [matchingWorkflow],
    })
    await webhookEndpoint.handler(
      createRequest({
        headers: { 'x-webhook-secret': 'correct-secret' },
        payload,
        webhookPath: 'orders',
      })
    )

    expect(executeMock).toHaveBeenCalledTimes(1)
    const [, context, , firedTrigger] = executeMock.mock.calls[0]

    expect(context.trigger.firedTrigger.webhookSecret).toBeUndefined()
    expect(firedTrigger.webhookSecret).toBeUndefined()
  })
})
