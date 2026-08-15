import { afterEach, describe, expect, it, vi } from 'vitest'

import { httpStepHandler } from '../src/steps/http-request-handler.js'

function makeArgs(input: unknown) {
  return {
    input,
    job: {},
    req: { payload: { logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } } },
  } as unknown as Parameters<typeof httpStepHandler>[0]
}

describe('httpStepHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails without hitting the network when the url is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpStepHandler(makeArgs({}))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.state).toBe('failed')
  })

  it('fails without hitting the network when the url is malformed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpStepHandler(makeArgs({ url: 'not-a-url' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.state).toBe('failed')
  })

  it('succeeds and parses a JSON response body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpStepHandler(makeArgs({ url: 'https://example.com/api' }))

    expect(result.state).toBe('succeeded')
    expect(result.output.status).toBe(200)
    expect(result.output.data).toEqual({ ok: true })
  })

  it('treats a non-2xx response as a succeeded step so workflows can branch on it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpStepHandler(makeArgs({ url: 'https://example.com/api' }))

    expect(result.state).toBe('succeeded')
    expect(result.output.status).toBe(500)
  })

  it('fails after exhausting retries on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpStepHandler(
      makeArgs({ retries: 1, retryDelay: 1, url: 'https://example.com/api' })
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.state).toBe('failed')
  })
})
