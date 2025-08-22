import type { Payload } from 'payload'

// Global logger instance - use Payload's logger type
let pluginLogger: Payload['logger'] | null = null

/**
 * Simple config-time logger for use during plugin configuration
 * Uses console with plugin prefix since Payload logger isn't available yet
 */
const configLogger = {
  debug: (message: string, ...args: any[]) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[payload-automation] ${message}`, ...args)
    }
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[payload-automation] ${message}`, ...args)
  },
  info: (message: string, ...args: any[]) => {
    console.log(`[payload-automation] ${message}`, ...args)
  },
  warn: (message: string, ...args: any[]) => {
    console.warn(`[payload-automation] ${message}`, ...args)
  }
}

/**
 * Get a logger for config-time use (before Payload initialization)
 */
export function getConfigLogger() {
  return configLogger
}

/**
 * Initialize the plugin logger using Payload's Pino instance
 * This creates a child logger with plugin identification
 */
export function initializeLogger(payload: Payload): Payload['logger'] {
  // Create a child logger with plugin identification
  pluginLogger = payload.logger.child({
    plugin: '@xtr-dev/payload-automation'
  })
  return pluginLogger
}

/**
 * Get the plugin logger instance
 * Throws error if not initialized
 */
export function getLogger(): Payload['logger'] {
  if (!pluginLogger) {
    throw new Error('@xtr-dev/payload-automation: Logger not initialized. Make sure the plugin is properly configured.')
  }

  return pluginLogger
}
