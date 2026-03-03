import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { checkAuth, AUTH_COOKIE } from '@/lib/auth'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  // If already authenticated (or auth disabled), go straight to the app.
  // Using checkAuth() instead of reading process.env.INVITE_CODE directly
  // avoids a redirect loop when the env var is visible in the protected layout
  // but not yet evaluated here at build time.
  const cookieStore = await cookies()
  const authCookie = cookieStore.get(AUTH_COOKIE)?.value
  if (checkAuth(authCookie)) {
    redirect('/')
  }

  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
