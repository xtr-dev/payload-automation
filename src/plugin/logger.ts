import type { Payload } from 'payload'

// Global logger instance - use Payload's logger type
let pluginLogger: null | Payload['logger'] = null

/**
 * Get the configured log level from environment variables
 * Supports: PAYLOAD_AUTOMATION_LOG_LEVEL for unified control
 * Or separate: PAYLOAD_AUTOMATION_CONFIG_LOG_LEVEL and PAYLOAD_AUTOMATION_LOG_LEVEL
 */
function getConfigLogLevel(): string {
  return process.env.PAYLOAD_AUTOMATION_CONFIG_LOG_LEVEL || 
         process.env.PAYLOAD_AUTOMATION_LOG_LEVEL || 
         'warn' // Default to warn level for production
}

/**
 * Simple config-time logger for use during plugin configuration
 * Uses console with plugin prefix since Payload logger isn't available yet
 */
const configLogger = {
  debug: <T>(message: string, ...args: T[]) => {
    const level = getConfigLogLevel()
    if (level === 'silent' || (level !== 'debug' && level !== 'trace')) {return}
    console.debug(`[payload-automation] ${message}`, ...args)
  },
  error: <T>(message: string, ...args: T[]) => {
    const level = getConfigLogLevel()
    if (level === 'silent') {return}
    console.error(`[payload-automation] ${message}`, ...args)
  },
  info: <T>(message: string, ...args: T[]) => {
    const level = getConfigLogLevel()
    if (level === 'silent' || level === 'error' || level === 'warn') {return}
    console.info(`[payload-automation] ${message}`, ...args)
  },
  warn: <T>(message: string, ...args: T[]) => {
    const level = getConfigLogLevel()
    if (level === 'silent' || level === 'error') {return}
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
  // Use PAYLOAD_AUTOMATION_LOG_LEVEL as the primary env var
  const logLevel = process.env.PAYLOAD_AUTOMATION_LOG_LEVEL || 
                   process.env.PAYLOAD_AUTOMATION_LOGGING || // Legacy support
                   'warn' // Default to warn level for production
  
  pluginLogger = payload.logger.child({
    level: logLevel,
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
