import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Build the public base URL from forwarded headers (set by reverse proxies like
  // Azure Container Apps / nginx). Falls back to request.url for local dev.
  const host = request.headers.get('x-forwarded-host') ?? new URL(request.url).host
  const proto = request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')
  const baseUrl = `${proto}://${host}`
  // 303 See Other so the browser GETs /login instead of re-posting
  const response = NextResponse.redirect(new URL('/login', baseUrl), { status: 303 })
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
