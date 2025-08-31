import type { Payload } from 'payload'

// Global logger instance - use Payload's logger type
let pluginLogger: null | Payload['logger'] = null

/**
 * Simple config-time logger for use during plugin configuration
 * Uses console with plugin prefix since Payload logger isn't available yet
 */
const configLogger = {
  debug: <T>(message: string, ...args: T[]) => {
    if (!process.env.PAYLOAD_AUTOMATION_CONFIG_LOGGING) {return}
    console.log(`[payload-automation] ${message}`, ...args)
  },
  error: <T>(message: string, ...args: T[]) => {
    if (!process.env.PAYLOAD_AUTOMATION_CONFIG_LOGGING) {return}
    console.error(`[payload-automation] ${message}`, ...args)
  },
  info: <T>(message: string, ...args: T[]) => {
    if (!process.env.PAYLOAD_AUTOMATION_CONFIG_LOGGING) {return}
    console.log(`[payload-automation] ${message}`, ...args)
  },
  warn: <T>(message: string, ...args: T[]) => {
    if (!process.env.PAYLOAD_AUTOMATION_CONFIG_LOGGING) {return}
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
    level: process.env.PAYLOAD_AUTOMATION_LOGGING || 'silent',
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
