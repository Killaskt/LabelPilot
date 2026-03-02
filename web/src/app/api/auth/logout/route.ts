import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 303 See Other so the browser GETs /login instead of re-posting
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
