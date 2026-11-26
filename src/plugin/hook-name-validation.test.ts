import type { Config } from 'payload'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { workflowsPlugin } from './index.js'

const buildConfig = (): Config =>
  ({
    collections: [{ slug: 'posts', fields: [] }],
    globals: [{ slug: 'settings', fields: [] }],
  }) as unknown as Config

describe('trigger hook name validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips and warns about an unknown collection hook name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config = workflowsPlugin({
      collectionTriggers: { posts: { afterChange: true, afterChnage: true } as never },
    })(buildConfig())

    const posts = config.collections!.find((c) => c.slug === 'posts')!
    expect(Object.keys(posts.hooks ?? {})).toEqual(['afterChange'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown hook 'afterChnage' for collection 'posts'"))
  })

  it('skips and warns about a hook name globals do not have', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config = workflowsPlugin({
      globalTriggers: { settings: { afterChange: true, afterDelete: true } as never },
    })(buildConfig())

    const settings = config.globals!.find((g) => g.slug === 'settings')!
    expect(Object.keys(settings.hooks ?? {})).toEqual(['afterChange'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown hook 'afterDelete' for global 'settings'"))
  })
})
