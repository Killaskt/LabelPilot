import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import LoginForm from './LoginForm'

export default function LoginPage() {
  // If auth is disabled (no INVITE_CODE), skip the login screen entirely
  if (!process.env.INVITE_CODE) {
    redirect('/')
  }
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
