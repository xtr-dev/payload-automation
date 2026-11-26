import { createHash, timingSafeEqual } from 'crypto'

/**
 * Stored webhookPath values may be entered with or without a leading/trailing
 * slash ("my-webhook" vs "/my-webhook"). The Triggers collection stores the
 * normalized form, and the webhook endpoint normalizes the requested path the
 * same way before looking it up.
 */
export const normalizeWebhookPath = (path: string): string =>
  path.trim().replace(/^\/+/, '').replace(/\/+$/, '')

/**
 * SHA-256 hex digest of a webhook secret. The automation-triggers collection
 * stores only this digest, so a database dump or an API read cannot recover
 * the secret. A fast unsalted hash is adequate for high-entropy secrets such
 * as `openssl rand -hex 32`; it does not protect a short, guessable one.
 */
export const hashWebhookSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex')

/**
 * Checks a provided secret against a stored digest from hashWebhookSecret.
 * Both sides are 32-byte SHA-256 digests, so timingSafeEqual compares equal
 * lengths and the comparison time does not depend on where they differ.
 */
export const webhookSecretMatches = (provided: string, storedHash: string): boolean => {
  const expected = Buffer.from(storedHash, 'hex')
  const actual = createHash('sha256').update(provided, 'utf8').digest()
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}
