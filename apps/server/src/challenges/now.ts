import type { FastifyRequest } from 'fastify'
import { HttpError } from '../auth.js'
import { testEnvironment } from '../config.js'

/**
 * Capture one clock value for a request. A TEST_ENVIRONMENT-only header makes
 * reset/boundary browser tests deterministic; production ignores it entirely.
 */
export function requestNow(request: FastifyRequest): number {
  const header = request.headers['x-aviarium-test-now']
  if (!testEnvironment || typeof header !== 'string') return Date.now()
  const parsed = Date.parse(header)
  if (!Number.isFinite(parsed) || Math.abs(parsed - Date.now()) > 400 * 86_400_000)
    throw new HttpError(400, 'invalid_request')
  return parsed
}
