import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { checkAuth, AUTH_COOKIE } from '@/lib/auth'

// Server component — reads process.env at request time (not build time).
// This is why auth lives here instead of middleware: middleware runs in the
// Edge Runtime where only build-time env vars are available.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const authCookie = cookieStore.get(AUTH_COOKIE)?.value
  if (!checkAuth(authCookie)) {
    redirect('/login')
  }
  return <>{children}</>
}
