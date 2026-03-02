import { NextRequest } from 'next/server'
import { checkAuth, AUTH_COOKIE } from '@/lib/auth'
import { POST as loginHandler } from '@/app/api/auth/login/route'
import { POST as logoutHandler } from '@/app/api/auth/logout/route'

// ─── Helpers ────────────────────────────────────────────────────────────────

const originalCode = process.env.INVITE_CODE

afterEach(() => {
  if (originalCode === undefined) {
    delete process.env.INVITE_CODE
  } else {
    process.env.INVITE_CODE = originalCode
  }
})

function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ─── checkAuth() ─────────────────────────────────────────────────────────────

describe('checkAuth', () => {
  it('returns true for any value when INVITE_CODE is not set', () => {
    delete process.env.INVITE_CODE
    expect(checkAuth(undefined)).toBe(true)
    expect(checkAuth('')).toBe(true)
    expect(checkAuth('anything')).toBe(true)
  })

  it('returns false when INVITE_CODE is set but cookie is absent', () => {
    process.env.INVITE_CODE = 'secret123'
    expect(checkAuth(undefined)).toBe(false)
    expect(checkAuth('')).toBe(false)
  })

  it('returns true when cookie exactly matches INVITE_CODE', () => {
    process.env.INVITE_CODE = 'secret123'
    expect(checkAuth('secret123')).toBe(true)
  })

  it('returns false when cookie does not match INVITE_CODE', () => {
    process.env.INVITE_CODE = 'secret123'
    expect(checkAuth('wrong')).toBe(false)
    expect(checkAuth('secret123 ')).toBe(false)   // trailing space
    expect(checkAuth('SECRET123')).toBe(false)     // case sensitive
  })
})

// ─── POST /api/auth/login ────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 401 when code is wrong', async () => {
    process.env.INVITE_CODE = 'secret123'
    const res = await loginHandler(makeLoginRequest({ code: 'wrong' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when code is empty and INVITE_CODE is set', async () => {
    process.env.INVITE_CODE = 'secret123'
    const res = await loginHandler(makeLoginRequest({ code: '' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 and sets HttpOnly auth cookie on correct code', async () => {
    process.env.INVITE_CODE = 'secret123'
    const res = await loginHandler(makeLoginRequest({ code: 'secret123' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${AUTH_COOKIE}=secret123`)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Max-Age=\d+/)
  })

  it('returns 200 when auth is disabled (no INVITE_CODE set)', async () => {
    delete process.env.INVITE_CODE
    const res = await loginHandler(makeLoginRequest({ code: 'anything' }))
    expect(res.status).toBe(200)
  })

  it('returns 200 with empty code when auth is disabled', async () => {
    delete process.env.INVITE_CODE
    const res = await loginHandler(makeLoginRequest({ code: '' }))
    expect(res.status).toBe(200)
  })

  it('returns 401 when body is not valid JSON', async () => {
    process.env.INVITE_CODE = 'secret123'
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json',
    })
    // body.code will be undefined → treated as empty string → wrong code
    const res = await loginHandler(req)
    expect(res.status).toBe(401)
  })

  it('trims whitespace from submitted code', async () => {
    process.env.INVITE_CODE = 'secret123'
    const res = await loginHandler(makeLoginRequest({ code: '  secret123  ' }))
    expect(res.status).toBe(200)
  })
})

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('redirects to /login (303 See Other)', async () => {
    const req = new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
    const res = await logoutHandler(req)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toMatch(/\/login$/)
  })

  it('expires the auth cookie', async () => {
    const req = new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
    const res = await logoutHandler(req)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${AUTH_COOKIE}=`)
    expect(setCookie).toMatch(/Max-Age=0/)
  })

  it('sets HttpOnly on the expired cookie', async () => {
    const req = new NextRequest('http://localhost/api/auth/logout', { method: 'POST' })
    const res = await logoutHandler(req)
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i)
  })
})
