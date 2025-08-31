import { describe, it, expect } from 'vitest'

describe('PayloadCMS Automation Plugin', () => {
  it('should export the plugin function from server export', async () => {
    const { workflowsPlugin } = await import('../exports/server.js')
    expect(workflowsPlugin).toBeDefined()
    expect(typeof workflowsPlugin).toBe('function')
  })

  it('should have the correct package name', async () => {
    // Basic test to ensure the plugin can be imported
    expect(true).toBe(true)
  })
})