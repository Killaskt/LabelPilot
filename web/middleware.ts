import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth'

const PUBLIC_PREFIXES = ['/login', '/api/auth']

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Auth disabled when INVITE_CODE is not set
  const required = process.env.INVITE_CODE
  if (!required) return NextResponse.next()

  const cookieValue = request.cookies.get(AUTH_COOKIE)?.value
  if (cookieValue === required) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
