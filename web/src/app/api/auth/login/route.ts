import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null)
  const code: string = typeof body?.code === 'string' ? body.code.trim() : ''

  const required = process.env.INVITE_CODE
  if (required && code !== required) {
    return errorResponse('UNAUTHORIZED', 'Invalid access code.', 401)
  }

  // If no INVITE_CODE is set we still issue a cookie so the flow is consistent
  const cookieValue = required ?? 'dev'
  const response = NextResponse.json({ ok: true })
  response.cookies.set(AUTH_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: '/',
  })
  return response
}
