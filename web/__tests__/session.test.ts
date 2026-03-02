import { getOrCreateSessionId, getSessionIdFromRequest } from '@/lib/session'
import { NextRequest } from 'next/server'

function makeRequest(cookieValue?: string): NextRequest {
  const headers = new Headers()
  if (cookieValue) {
    headers.set('cookie', `reviewerSessionId=${cookieValue}`)
  }
  return new NextRequest('http://localhost/api/test', { headers })
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'
const BAD_VALUES = ['', 'not-a-uuid', 'undefined', '<script>alert(1)</script>']

describe('getOrCreateSessionId', () => {
  it('returns existing valid UUID from cookie', () => {
    const req = makeRequest(VALID_UUID)
    const { sessionId, isNew } = getOrCreateSessionId(req)
    expect(sessionId).toBe(VALID_UUID)
    expect(isNew).toBe(false)
  })

  it('generates a new UUID when cookie is absent', () => {
    const req = makeRequest()
    const { sessionId, isNew } = getOrCreateSessionId(req)
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(isNew).toBe(true)
  })

  it.each(BAD_VALUES)('generates new UUID for invalid cookie value: %s', (val) => {
    const req = makeRequest(val)
    const { isNew } = getOrCreateSessionId(req)
    expect(isNew).toBe(true)
  })
})

describe('getSessionIdFromRequest', () => {
  it('returns session ID when valid cookie present', () => {
    const req = makeRequest(VALID_UUID)
    expect(getSessionIdFromRequest(req)).toBe(VALID_UUID)
  })

  it('returns null when cookie is absent', () => {
    const req = makeRequest()
    expect(getSessionIdFromRequest(req)).toBeNull()
  })

  it.each(BAD_VALUES)('returns null for invalid value: %s', (val) => {
    const req = makeRequest(val)
    expect(getSessionIdFromRequest(req)).toBeNull()
  })
})
