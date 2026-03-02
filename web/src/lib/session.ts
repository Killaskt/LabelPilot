import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

export const SESSION_COOKIE = 'reviewerSessionId'
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value)
}

export function getOrCreateSessionId(request: NextRequest): {
  sessionId: string
  isNew: boolean
} {
  const existing = request.cookies.get(SESSION_COOKIE)?.value
  if (existing && isValidUUID(existing)) {
    return { sessionId: existing, isNew: false }
  }
  return { sessionId: uuidv4(), isNew: true }
}

export function getSessionIdFromRequest(request: NextRequest): string | null {
  const value = request.cookies.get(SESSION_COOKIE)?.value
  if (value && isValidUUID(value)) return value
  return null
}
